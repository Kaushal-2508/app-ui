# SALCI Olympiad Phase 1 — Super Admin Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the super-admin Olympiad catalog (campaigns, subjects, topics, questions, study materials, schools roster shell) plus the `olympiad` feature-flag card in the Edit Institution > Features grid. Nothing student- or school-facing yet.

**Architecture:** Single migration drops 7 `oly_*` tables + lock trigger + RLS + a storage bucket. A new `/admin/olympiad` route with internal `MobileTabs` (Campaign / Subjects / Schools) lazy-loads three tab pages plus a Subject detail page with nested sub-tabs (Topics / Questions / Study Material). All persistence flows through a small set of hooks under `src/hooks/olympiad/` that call typed Supabase queries or the new `oly_question_bank_view` / `oly_questions_upsert` RPCs. CSV bulk import is parsed client-side via PapaParse, validated row-by-row, then submitted to a new edge function `oly-question-csv-import` for transactional bulk insert. Question authoring uses the existing `MathPreview` for KaTeX preview (CLAUDE.md §8); zero student-facing rendering this phase.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, React Router v6, Supabase (PostgreSQL + RLS + Storage + Edge Functions), shadcn/ui + Tailwind, lucide-react icons, papaparse@5.5 (already a dep), KaTeX via existing `MathPreview`.

**Spec:** [docs/superpowers/specs/2026-05-26-olympiad-phase-1-super-admin-catalog-design.md](../specs/2026-05-26-olympiad-phase-1-super-admin-catalog-design.md)
**Master decomposition:** [docs/superpowers/specs/2026-05-26-olympiad-master-decomposition-design.md](../specs/2026-05-26-olympiad-master-decomposition-design.md)

**No test infrastructure in this repo** (no Vitest/Jest config, no `*.test.ts` files under `src/`). Verification gates are CLAUDE.md §5a — `npx tsc --noEmit`, `npx eslint <changed-paths>`, `npx vite build` all exit 0 — plus manual smoke at 375 px in light + dark mode per CLAUDE.md §20b. No unit-test tasks.

**Engineer assumptions:** the engineer knows React + TypeScript but does NOT know SALCI's conventions. They must read CLAUDE.md sections §5a (zero-error contract), §6/§19 (error translation via `toastError`), §17 (Service Worker dirty-form contract), §20a/§20b (mobile design system + new-page checklist), §22 (RLS recursion trap — no inline cross-table EXISTS), §23 (high-concurrency rules — explicit `staleTime`, no `select("*")`, pagination, every FK indexed) before starting.

---

## File Structure

```
supabase/
  migrations/
    <timestamp>_oly_phase_1_catalog.sql         (NEW)  — all 7 tables, lock trigger, RLS, helpers
  functions/
    oly-question-csv-import/
      index.ts                                  (NEW)  — Deno edge function, transactional bulk insert

src/
  components/
    admin/
      institution-wizard/
        featuresData.ts                         (EDIT) — add olympiad entry + FEATURE_URL_MAP entries
    olympiad/
      admin/
        CampaignSettingsForm.tsx                (NEW)  — campaign editor body
        CampaignStatusPill.tsx                  (NEW)  — Draft/Active/Closed pill + Set Active
        SubjectEditorSheet.tsx                  (NEW)  — create/edit oly_subject via MobileSheet
        SubjectListRow.tsx                      (NEW)  — one row for a subject in the Subjects tab
        TopicEditorSheet.tsx                    (NEW)  — create/edit oly_topic
        QuestionEditorSheet.tsx                 (NEW)  — single-question authoring with MathPreview
        QuestionBankTable.tsx                   (NEW)  — filter+sort+list+bulk actions
        QuestionCsvImportSheet.tsx              (NEW)  — template download + parse + preview + import
        StudyMaterialUploadSheet.tsx            (NEW)  — single file upload
        StudyMaterialBulkUploadSheet.tsx        (NEW)  — drag-and-drop multi-file batch
        StudyMaterialListRow.tsx                (NEW)  — one row in the Study Material list
  hooks/
    olympiad/
      useOlympiadCampaign.ts                    (NEW)  — current year + history + upsert
      useOlympiadSubjects.ts                    (NEW)  — list, upsert, archive
      useOlympiadTopics.ts                      (NEW)  — list per (subject, grade_level), upsert
      useOlympiadQuestionBank.ts                (NEW)  — paginated bank view + filters/sort
      useOlympiadQuestionUpsert.ts              (NEW)  — single-question insert/update
      useOlympiadQuestionBulkAction.ts          (NEW)  — bulk activate/deactivate
      useOlympiadStudyMaterials.ts              (NEW)  — list + upload + signed URL
      useOlympiadCampaignStats.ts               (NEW)  — counts for the StatTileGrid
  lib/
    olympiad/
      money.ts                                  (NEW)  — formatOlympiadFee helper
      csv.ts                                    (NEW)  — CSV parse + validate helpers
  pages/
    admin/
      olympiad/
        OlympiadAdminPage.tsx                   (NEW)  — shell with internal MobileTabs + Outlet
        OlympiadCampaignTab.tsx                 (NEW)  — campaign editor surface
        OlympiadSubjectsTab.tsx                 (NEW)  — subject list
        OlympiadSubjectDetailPage.tsx           (NEW)  — shell with Topics/Questions/StudyMat sub-tabs
        OlympiadTopicsSubTab.tsx                (NEW)  — topic editor surface
        OlympiadQuestionsSubTab.tsx             (NEW)  — bank view + add + CSV import
        OlympiadStudyMaterialSubTab.tsx         (NEW)  — material list + upload
        OlympiadSchoolsTab.tsx                  (NEW)  — empty state + disabled button
  App.tsx                                       (EDIT) — register lazy routes
  components/layout/AppSidebar.tsx              (EDIT) — add Olympiad sidebar entry for super_admin
```

Each file has one responsibility. Pages own routing + composition; tab components own surface logic; sheets own create/edit forms; hooks own data flow; lib/ helpers are pure.

---

## Section A — Foundation

Section A delivers the database, the feature-flag card, and the route shell. After Section A, navigating to `/admin/olympiad` lands on an empty Campaign tab with the shell working. No surfaces editable yet beyond the feature-flag toggle.

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/<timestamp>_oly_phase_1_catalog.sql` — replace `<timestamp>` with output of `date -u +%Y%m%d%H%M%S` (e.g. `20260526120000`)

- [ ] **Step 1.1: Generate the timestamp**

Run:
```bash
date -u +%Y%m%d%H%M%S
```
Use the output as the filename prefix in Step 1.2. If on Windows PowerShell:
```powershell
Get-Date -AsUTC -Format yyyyMMddHHmmss
```

- [ ] **Step 1.2: Create the migration file with the full SQL**

```sql
-- Phase 1 — Olympiad super-admin catalog
-- Adds 7 oly_* tables, lock trigger, RLS via existing is_super_admin() helper,
-- and the olympiad-study-material storage bucket with policies.

-- =========================================================================
-- 1. Campaigns (one row per campaign year)
-- =========================================================================
create table public.oly_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_year smallint not null unique check (campaign_year between 2024 and 2100),
  default_price_paise integer not null check (default_price_paise > 0),
  gst_percent numeric(5,2) not null default 18.00 check (gst_percent >= 0 and gst_percent <= 100),
  exam_duration_minutes integer not null default 90 check (exam_duration_minutes > 0),
  questions_per_subject integer not null default 30 check (questions_per_subject > 0),
  pin_expiry_minutes integer not null default 120 check (pin_expiry_minutes > 0),
  gold_threshold_percent numeric(5,2) not null default 85.00,
  silver_threshold_percent numeric(5,2) not null default 70.00,
  bronze_threshold_percent numeric(5,2) not null default 50.00,
  gstin text,
  status text not null default 'draft' check (status in ('draft','active','closed')),
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_oly_campaigns_status on public.oly_campaigns(status);
create index idx_oly_campaigns_created_by on public.oly_campaigns(created_by);

-- =========================================================================
-- 2. Subjects + class applicability
-- =========================================================================
create table public.oly_subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(name)
);

create table public.oly_subject_classes (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(subject_id, grade_level_id)
);
create index idx_osc_subject on public.oly_subject_classes(subject_id);
create index idx_osc_grade_level on public.oly_subject_classes(grade_level_id);

-- =========================================================================
-- 3. Topics per (subject, grade_level)
-- =========================================================================
create table public.oly_topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  name text not null,
  status text not null default 'active' check (status in ('active','archived')),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subject_id, grade_level_id, name)
);
create index idx_oly_topics_subject_grade on public.oly_topics(subject_id, grade_level_id);
create index idx_oly_topics_status on public.oly_topics(status);

-- =========================================================================
-- 4. Question bank
-- =========================================================================
create table public.oly_questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  topic_id uuid references public.oly_topics(id) on delete set null,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer char(1) not null check (correct_answer in ('A','B','C','D')),
  internal_notes text,
  status text not null default 'active' check (status in ('active','inactive')),
  image_url text,
  times_used integer not null default 0,
  total_correct integer not null default 0,
  total_attempts integer not null default 0,
  total_time_seconds bigint not null default 0,
  last_used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_oly_questions_subject_grade on public.oly_questions(subject_id, grade_level_id);
create index idx_oly_questions_topic on public.oly_questions(topic_id);
create index idx_oly_questions_status on public.oly_questions(status);
create index idx_oly_questions_created_by on public.oly_questions(created_by);

-- =========================================================================
-- 5. Study materials
-- =========================================================================
create table public.oly_study_materials (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  title text not null,
  description text,
  storage_path text not null,
  file_size_bytes integer not null check (file_size_bytes > 0),
  display_order integer not null default 0,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_osm_subject_grade on public.oly_study_materials(subject_id, grade_level_id);
create index idx_osm_display_order on public.oly_study_materials(display_order);

-- =========================================================================
-- 6. Schools roster (rows arrive in Phase 2)
-- =========================================================================
create table public.oly_schools (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  school_short_code text not null unique check (school_short_code ~ '^[A-Z0-9]{6}$'),
  city text,
  state text,
  primary_contact_name text not null,
  primary_contact_email text not null,
  primary_contact_phone text not null,
  participating_grade_level_ids uuid[] not null default '{}',
  price_override_paise integer check (price_override_paise > 0),
  is_existing_salci_school boolean not null default false,
  status text not null default 'enrollment_open'
    check (status in ('enrollment_open','enrollment_closed','batches_scheduled',
                      'exam_in_progress','results_published','archived')),
  internal_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, institution_id)
);
create index idx_oly_schools_campaign on public.oly_schools(campaign_id);
create index idx_oly_schools_institution on public.oly_schools(institution_id);
create index idx_oly_schools_status on public.oly_schools(status);

-- =========================================================================
-- 7. Updated_at triggers
-- =========================================================================
create or replace function public.oly_set_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger oly_campaigns_set_updated_at before update on public.oly_campaigns
  for each row execute function public.oly_set_updated_at();
create trigger oly_subjects_set_updated_at before update on public.oly_subjects
  for each row execute function public.oly_set_updated_at();
create trigger oly_topics_set_updated_at before update on public.oly_topics
  for each row execute function public.oly_set_updated_at();
create trigger oly_questions_set_updated_at before update on public.oly_questions
  for each row execute function public.oly_set_updated_at();
create trigger oly_schools_set_updated_at before update on public.oly_schools
  for each row execute function public.oly_set_updated_at();

-- =========================================================================
-- 8. Lock trigger — once campaign is active AND any school has enrolled
-- =========================================================================
create or replace function public.oly_campaign_lock_check()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  has_enrolled_school boolean;
begin
  if (old.status = 'active' and new.status = 'active') then
    select exists(
      select 1 from public.oly_schools
       where campaign_id = new.id
         and status != 'enrollment_open'
    ) into has_enrolled_school;

    if has_enrolled_school then
      if (new.exam_duration_minutes != old.exam_duration_minutes
       or new.questions_per_subject != old.questions_per_subject
       or new.gst_percent != old.gst_percent
       or new.gold_threshold_percent != old.gold_threshold_percent
       or new.silver_threshold_percent != old.silver_threshold_percent
       or new.bronze_threshold_percent != old.bronze_threshold_percent) then
        raise exception 'Cannot edit locked campaign fields once schools have enrolled. Default price and per-school overrides remain editable.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger oly_campaign_lock_before_update
  before update on public.oly_campaigns
  for each row execute function public.oly_campaign_lock_check();

-- =========================================================================
-- 9. RLS — super admin full access on all oly_* tables
-- =========================================================================
alter table public.oly_campaigns enable row level security;
create policy "super_admin all" on public.oly_campaigns for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_subjects enable row level security;
create policy "super_admin all" on public.oly_subjects for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_subject_classes enable row level security;
create policy "super_admin all" on public.oly_subject_classes for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_topics enable row level security;
create policy "super_admin all" on public.oly_topics for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_questions enable row level security;
create policy "super_admin all" on public.oly_questions for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_study_materials enable row level security;
create policy "super_admin all" on public.oly_study_materials for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_schools enable row level security;
create policy "super_admin all" on public.oly_schools for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- =========================================================================
-- 10. RPC — paginated question-bank view (avoids select * + serves derived metrics)
-- =========================================================================
create or replace function public.oly_question_bank_view(
  p_subject_id uuid,
  p_grade_level_id uuid,
  p_topic_id uuid default null,
  p_status text default null,
  p_sort text default 'last_used_desc',
  p_page integer default 1,
  p_page_size integer default 25
)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := greatest(0, (p_page - 1) * p_page_size);
  v_rows jsonb;
  v_total integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v_total
    from public.oly_questions q
   where q.subject_id = p_subject_id
     and q.grade_level_id = p_grade_level_id
     and (p_topic_id is null or q.topic_id = p_topic_id)
     and (p_status is null or q.status = p_status);

  select coalesce(jsonb_agg(row_to_jsonb(x)), '[]'::jsonb) into v_rows
    from (
      select
        q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
        q.correct_answer, q.topic_id, q.status, q.times_used, q.total_correct,
        q.total_attempts, q.total_time_seconds, q.last_used_at, q.updated_at,
        t.name as topic_name,
        case when q.total_attempts > 0
          then round((q.total_correct::numeric / q.total_attempts) * 100, 2)
          else null end as avg_correct_rate_percent,
        case when q.total_attempts > 0
          then round((q.total_time_seconds::numeric / q.total_attempts), 2)
          else null end as avg_time_seconds
      from public.oly_questions q
      left join public.oly_topics t on t.id = q.topic_id
      where q.subject_id = p_subject_id
        and q.grade_level_id = p_grade_level_id
        and (p_topic_id is null or q.topic_id = p_topic_id)
        and (p_status is null or q.status = p_status)
      order by
        case when p_sort = 'avg_correct_rate_asc' then
          coalesce((q.total_correct::numeric / nullif(q.total_attempts, 0)), 999) end asc nulls last,
        case when p_sort = 'times_used_desc' then q.times_used end desc nulls last,
        case when p_sort = 'last_used_desc' then q.last_used_at end desc nulls last,
        q.created_at desc
      limit p_page_size offset v_offset
    ) x;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', p_page, 'page_size', p_page_size);
end;
$$;

-- =========================================================================
-- 11. RPC — single-question upsert (atomic; returns the row)
-- =========================================================================
create or replace function public.oly_questions_upsert(p_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_row record;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_id := nullif(p_payload->>'id', '')::uuid;

  if v_id is null then
    insert into public.oly_questions (
      subject_id, grade_level_id, topic_id, question_text,
      option_a, option_b, option_c, option_d, correct_answer,
      internal_notes, status, created_by
    ) values (
      (p_payload->>'subject_id')::uuid,
      (p_payload->>'grade_level_id')::uuid,
      nullif(p_payload->>'topic_id','')::uuid,
      p_payload->>'question_text',
      p_payload->>'option_a',
      p_payload->>'option_b',
      p_payload->>'option_c',
      p_payload->>'option_d',
      p_payload->>'correct_answer',
      p_payload->>'internal_notes',
      coalesce(p_payload->>'status','active'),
      auth.uid()
    ) returning * into v_row;
  else
    update public.oly_questions set
      topic_id = nullif(p_payload->>'topic_id','')::uuid,
      question_text = p_payload->>'question_text',
      option_a = p_payload->>'option_a',
      option_b = p_payload->>'option_b',
      option_c = p_payload->>'option_c',
      option_d = p_payload->>'option_d',
      correct_answer = p_payload->>'correct_answer',
      internal_notes = p_payload->>'internal_notes',
      status = coalesce(p_payload->>'status', status)
    where id = v_id
    returning * into v_row;
  end if;

  return row_to_jsonb(v_row);
end;
$$;

-- =========================================================================
-- 12. RPC — campaign overview stats for StatTileGrid
-- =========================================================================
create or replace function public.oly_campaign_stats(p_campaign_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total_subjects integer;
  v_total_topics integer;
  v_total_questions integer;
  v_total_materials integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v_total_subjects from public.oly_subjects where status = 'active';
  select count(*) into v_total_topics from public.oly_topics where status = 'active';
  select count(*) into v_total_questions from public.oly_questions where status = 'active';
  select count(*) into v_total_materials from public.oly_study_materials;

  return jsonb_build_object(
    'total_subjects', v_total_subjects,
    'total_topics', v_total_topics,
    'total_questions', v_total_questions,
    'total_materials', v_total_materials
  );
end;
$$;

-- =========================================================================
-- 13. Storage bucket for study materials
-- =========================================================================
insert into storage.buckets (id, name, public) values ('olympiad-study-material', 'olympiad-study-material', false)
  on conflict (id) do nothing;

create policy "super_admin can manage olympiad-study-material"
  on storage.objects for all
  using (bucket_id = 'olympiad-study-material' and public.is_super_admin(auth.uid()))
  with check (bucket_id = 'olympiad-study-material' and public.is_super_admin(auth.uid()));

-- =========================================================================
-- 14. Grants for the RPCs (authenticated users only — RPC bodies check role)
-- =========================================================================
grant execute on function public.oly_question_bank_view(uuid, uuid, uuid, text, text, integer, integer) to authenticated;
grant execute on function public.oly_questions_upsert(jsonb) to authenticated;
grant execute on function public.oly_campaign_stats(uuid) to authenticated;
```

- [ ] **Step 1.3: Apply the migration locally**

Run:
```bash
npx supabase db push
```
Expected: migration applied with no errors. If `is_super_admin` is missing, the migration will fail with `function is_super_admin does not exist` — confirm it exists first via:
```bash
npx supabase db diff --schema public
```
The repo migration `20260114073618_*.sql` already defines it.

- [ ] **Step 1.4: Regenerate Supabase types**

Run:
```bash
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
```
Expected: the new `oly_*` table types appear under `Database['public']['Tables']`. If the project ID differs, use the value from `supabase/config.toml`.

- [ ] **Step 1.5: Verify zero-error contract**

Run:
```bash
npx tsc --noEmit
```
Expected: exit 0. The regenerated types should not break anything in the existing tree.

- [ ] **Step 1.6: Commit**

```bash
git add supabase/migrations/<timestamp>_oly_phase_1_catalog.sql src/integrations/supabase/types.ts
git commit -m "feat(olympiad): phase 1 — db schema for super-admin catalog"
```

---

### Task 2: Feature-flag card

**Files:**
- Modify: `src/components/admin/institution-wizard/featuresData.ts`

- [ ] **Step 2.1: Add the `olympiad` entry to `AVAILABLE_FEATURES` and import the icon**

Edit the top import to add `Medal`:
```ts
import {
  BookOpen, FileText, Users, BarChart3, ClipboardCheck, Video,
  MessageSquare, Shield, Layers, GraduationCap, FileCheck, Coins,
  Brain, Calendar, DollarSign, Briefcase, Bell, CalendarDays,
  UserCheck, Fingerprint, Sparkles, Database, Medal,
} from "lucide-react";
```

(Use `Medal`; `Trophy` and `Award` are already used elsewhere in `AppSidebar.tsx`.)

Append to `AVAILABLE_FEATURES`, after the existing `biometric_attendance` row, still inside the `advanced` group:
```ts
  { id: "olympiad", name: "SALCI Olympiad", description: "Run the SALCI Olympiad campaign for this school", icon: Medal, category: "advanced", isDefault: false },
```

- [ ] **Step 2.2: Add three URL-map entries**

In the same file, append to `FEATURE_URL_MAP`:
```ts
  "/school/olympiad": "olympiad",
  "/teacher/olympiad": "olympiad",
  "/student/olympiad": "olympiad",
```

(Do NOT add `/admin/olympiad` — super admin sees its own Olympiad route regardless of any institution's flag.)

- [ ] **Step 2.3: Verify**

Run:
```bash
npx tsc --noEmit
npx eslint src/components/admin/institution-wizard/featuresData.ts
```
Expected: exit 0 on both.

- [ ] **Step 2.4: Smoke test the Features grid**

Run the app: `npm run dev`. As super_admin, open Institutions → Edit any institution → Features tab. Scroll to "Advanced" — the "SALCI Olympiad" card should render with the Medal icon.

- [ ] **Step 2.5: Commit**

```bash
git add src/components/admin/institution-wizard/featuresData.ts
git commit -m "feat(olympiad): add SALCI Olympiad feature-flag card"
```

---

### Task 3: `formatOlympiadFee` helper

**Files:**
- Create: `src/lib/olympiad/money.ts`

- [ ] **Step 3.1: Create the helper**

```ts
export type OlympiadFeeBreakdown = {
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  baseRupees: string;
  gstRupees: string;
  totalRupees: string;
  display: string;
};

function paiseToRupeesString(paise: number): string {
  const rupees = paise / 100;
  if (Number.isInteger(rupees)) return `₹${rupees.toFixed(0)}`;
  return `₹${rupees.toFixed(2)}`;
}

export function formatOlympiadFee(basePaise: number, gstPercent: number): OlympiadFeeBreakdown {
  if (!Number.isFinite(basePaise) || basePaise <= 0) {
    throw new Error("basePaise must be a positive number");
  }
  if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) {
    throw new Error("gstPercent must be between 0 and 100");
  }

  const gstPaise = Math.round((basePaise * gstPercent) / 100);
  const totalPaise = basePaise + gstPaise;

  const baseRupees = paiseToRupeesString(basePaise);
  const gstRupees = paiseToRupeesString(gstPaise);
  const totalRupees = paiseToRupeesString(totalPaise);

  return {
    basePaise,
    gstPaise,
    totalPaise,
    baseRupees,
    gstRupees,
    totalRupees,
    display: `${baseRupees} + ${gstPercent.toFixed(0)}% GST = ${totalRupees}`,
  };
}
```

- [ ] **Step 3.2: Verify**

Run:
```bash
npx tsc --noEmit
npx eslint src/lib/olympiad/money.ts
```
Expected: exit 0.

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/olympiad/money.ts
git commit -m "feat(olympiad): add formatOlympiadFee helper"
```

---

### Task 4: Route shell — `OlympiadAdminPage` + `App.tsx` wiring

**Files:**
- Create: `src/pages/admin/olympiad/OlympiadAdminPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 4.1: Build the shell page**

`src/pages/admin/olympiad/OlympiadAdminPage.tsx`:
```tsx
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Medal } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";

const TABS = [
  { value: "campaign", label: "Campaign", to: "/admin/olympiad" },
  { value: "subjects", label: "Subjects", to: "/admin/olympiad/subjects" },
  { value: "schools",  label: "Schools",  to: "/admin/olympiad/schools" },
] as const;

function resolveActive(pathname: string): typeof TABS[number]["value"] {
  if (pathname.startsWith("/admin/olympiad/subjects")) return "subjects";
  if (pathname.startsWith("/admin/olympiad/schools"))  return "schools";
  return "campaign";
}

export default function OlympiadAdminPage() {
  const { pathname } = useLocation();
  const active = resolveActive(pathname);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Super Admin"
        title="SALCI Olympiad"
        subtitle="Campaign settings, subjects, and participating schools"
        icon={<Medal className="h-6 w-6 text-brand-primary" />}
      />
      <MobileTabs
        value={active}
        tabs={TABS.map((t) => ({
          value: t.value,
          label: t.label,
          render: () => <NavLink to={t.to} />,
        }))}
        renderTab={(t) => (
          <NavLink
            to={(TABS.find((x) => x.value === t.value) ?? TABS[0]).to}
            className={({ isActive }) =>
              `inline-flex items-center px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-colors ${
                isActive || t.value === active
                  ? "bg-brand-primary text-white"
                  : "bg-surface-card text-ink-700 hover:bg-surface-card/80"
              }`
            }
          >
            {t.label}
          </NavLink>
        )}
      />
      <Outlet />
    </PageShell>
  );
}
```

If `MobileTabs` does NOT support a `renderTab` prop (verify by reading `src/components/shared/nav/MobileTabs.tsx`), simplify by rendering the NavLinks inline as a horizontal scroll-snap strip styled per CLAUDE.md §20a:
```tsx
<nav className="-mx-4 px-4 flex gap-2 overflow-x-auto scrollbar-hide sticky top-[var(--app-bar-height)] z-10 bg-transparent">
  {TABS.map((t) => (
    <NavLink
      key={t.value}
      to={t.to}
      end={t.to === "/admin/olympiad"}
      className={({ isActive }) =>
        `inline-flex items-center px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-colors ${
          isActive ? "bg-brand-primary text-white" : "bg-surface-card text-ink-700 hover:bg-surface-card/80"
        }`
      }
    >
      {t.label}
    </NavLink>
  ))}
</nav>
```

Pick whichever signature matches the current `MobileTabs.tsx` source. Keep the page-level call exactly compatible with the rest of the codebase.

- [ ] **Step 4.2: Register lazy routes in `src/App.tsx`**

At the top, near the other `lazy()` imports, add:
```tsx
const OlympiadAdminPage = lazy(() => import("@/pages/admin/olympiad/OlympiadAdminPage"));
const OlympiadCampaignTab = lazy(() => import("@/pages/admin/olympiad/OlympiadCampaignTab"));
const OlympiadSubjectsTab = lazy(() => import("@/pages/admin/olympiad/OlympiadSubjectsTab"));
const OlympiadSubjectDetailPage = lazy(() => import("@/pages/admin/olympiad/OlympiadSubjectDetailPage"));
const OlympiadTopicsSubTab = lazy(() => import("@/pages/admin/olympiad/OlympiadTopicsSubTab"));
const OlympiadQuestionsSubTab = lazy(() => import("@/pages/admin/olympiad/OlympiadQuestionsSubTab"));
const OlympiadStudyMaterialSubTab = lazy(() => import("@/pages/admin/olympiad/OlympiadStudyMaterialSubTab"));
const OlympiadSchoolsTab = lazy(() => import("@/pages/admin/olympiad/OlympiadSchoolsTab"));
```

In the Super Admin routes block (after line ~338 where `/admin/question-bank` is registered), insert:
```tsx
<Route path="/admin/olympiad" element={
  <ProtectedRoute allowedRoles={["super_admin"]}>
    <OlympiadAdminPage />
  </ProtectedRoute>
}>
  <Route index element={<OlympiadCampaignTab />} />
  <Route path="subjects" element={<OlympiadSubjectsTab />} />
  <Route path="subjects/:subjectId" element={<OlympiadSubjectDetailPage />}>
    <Route index element={<OlympiadTopicsSubTab />} />
    <Route path="questions" element={<OlympiadQuestionsSubTab />} />
    <Route path="study-material" element={<OlympiadStudyMaterialSubTab />} />
  </Route>
  <Route path="schools" element={<OlympiadSchoolsTab />} />
</Route>
```

- [ ] **Step 4.3: Create placeholder tab files (avoid build failures from missing imports)**

For each lazy import, create a placeholder page that the next tasks will fill in:

`src/pages/admin/olympiad/OlympiadCampaignTab.tsx`:
```tsx
export default function OlympiadCampaignTab() {
  return <div className="py-4">Campaign tab — Task 8 will fill this in.</div>;
}
```

Same single-line skeleton for: `OlympiadSubjectsTab.tsx`, `OlympiadSubjectDetailPage.tsx`, `OlympiadTopicsSubTab.tsx`, `OlympiadQuestionsSubTab.tsx`, `OlympiadStudyMaterialSubTab.tsx`, `OlympiadSchoolsTab.tsx`. Change "Campaign tab" to the appropriate name in each file.

For `OlympiadSubjectDetailPage.tsx`, include an `Outlet`:
```tsx
import { Outlet } from "react-router-dom";
export default function OlympiadSubjectDetailPage() {
  return (
    <div className="py-4">
      <div className="text-sm text-muted-foreground mb-4">Subject detail — Task 9 will fill this in.</div>
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 4.4: Verify zero-error contract**

Run:
```bash
npx tsc --noEmit
npx eslint src/App.tsx src/pages/admin/olympiad/
npx vite build
```
Expected: all three exit 0.

- [ ] **Step 4.5: Commit**

```bash
git add src/App.tsx src/pages/admin/olympiad/
git commit -m "feat(olympiad): scaffold /admin/olympiad routes + page shell"
```

---

### Task 5: Sidebar entry for super_admin

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx`

- [ ] **Step 5.1: Read the existing super_admin section**

Open `src/components/layout/AppSidebar.tsx` and find the super_admin nav list (search `super_admin` to locate it — likely a `superAdminItems` or similar array). Note where `/admin/question-bank` is placed; we'll insert Olympiad immediately after.

- [ ] **Step 5.2: Add the import + entry**

If `Medal` is not already imported, add it to the lucide-react import.

In the super_admin nav array, after the `/admin/question-bank` entry, insert:
```tsx
{ url: "/admin/olympiad", label: "Olympiad", icon: Medal },
```

(Match the existing shape — if the existing entries use `title` instead of `label`, or `href` instead of `url`, mirror that.)

- [ ] **Step 5.3: Verify**

Run:
```bash
npx tsc --noEmit
npx eslint src/components/layout/AppSidebar.tsx
```
Expected: exit 0.

- [ ] **Step 5.4: Smoke test**

`npm run dev`, log in as super_admin. The sidebar should now show "Olympiad" with a Medal icon under the existing super-admin entries. Click it — should navigate to `/admin/olympiad` and render the shell with the three placeholder tabs visible.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/layout/AppSidebar.tsx
git commit -m "feat(olympiad): add Olympiad sidebar entry for super admin"
```

---

### Task 6: `useOlympiadCampaign` hook + Campaign tab

**Files:**
- Create: `src/hooks/olympiad/useOlympiadCampaign.ts`
- Create: `src/components/olympiad/admin/CampaignSettingsForm.tsx`
- Create: `src/components/olympiad/admin/CampaignStatusPill.tsx`
- Modify: `src/pages/admin/olympiad/OlympiadCampaignTab.tsx`

- [ ] **Step 6.1: Create the hook**

`src/hooks/olympiad/useOlympiadCampaign.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type OlympiadCampaign = {
  id: string;
  campaign_year: number;
  default_price_paise: number;
  gst_percent: number;
  exam_duration_minutes: number;
  questions_per_subject: number;
  pin_expiry_minutes: number;
  gold_threshold_percent: number;
  silver_threshold_percent: number;
  bronze_threshold_percent: number;
  gstin: string | null;
  status: "draft" | "active" | "closed";
  description: string | null;
  created_at: string;
  updated_at: string;
};

export function useOlympiadCampaigns() {
  return useQuery({
    queryKey: ["olympiad", "campaigns"],
    queryFn: async (): Promise<OlympiadCampaign[]> => {
      const { data, error } = await supabase
        .from("oly_campaigns")
        .select("id, campaign_year, default_price_paise, gst_percent, exam_duration_minutes, questions_per_subject, pin_expiry_minutes, gold_threshold_percent, silver_threshold_percent, bronze_threshold_percent, gstin, status, description, created_at, updated_at")
        .order("campaign_year", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OlympiadCampaign[];
    },
    staleTime: 60_000,
  });
}

export type OlympiadCampaignInput = Omit<OlympiadCampaign, "id" | "created_at" | "updated_at"> & { id?: string };

export function useUpsertOlympiadCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OlympiadCampaignInput): Promise<OlympiadCampaign> => {
      const payload = {
        campaign_year: input.campaign_year,
        default_price_paise: input.default_price_paise,
        gst_percent: input.gst_percent,
        exam_duration_minutes: input.exam_duration_minutes,
        questions_per_subject: input.questions_per_subject,
        pin_expiry_minutes: input.pin_expiry_minutes,
        gold_threshold_percent: input.gold_threshold_percent,
        silver_threshold_percent: input.silver_threshold_percent,
        bronze_threshold_percent: input.bronze_threshold_percent,
        gstin: input.gstin,
        status: input.status,
        description: input.description,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from("oly_campaigns")
          .update(payload)
          .eq("id", input.id)
          .select()
          .single();
        if (error) throw error;
        return data as OlympiadCampaign;
      }
      const { data, error } = await supabase
        .from("oly_campaigns")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as OlympiadCampaign;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "campaigns"] });
      toast.success("Campaign saved");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't save campaign.", context: "useUpsertOlympiadCampaign" }),
  });
}
```

- [ ] **Step 6.2: Build `CampaignStatusPill`**

`src/components/olympiad/admin/CampaignStatusPill.tsx`:
```tsx
import { Badge } from "@/components/ui/badge";

type Status = "draft" | "active" | "closed";

const STYLE: Record<Status, string> = {
  draft:  "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  active: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  closed: "bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
};

export function CampaignStatusPill({ status }: { status: Status }) {
  return (
    <Badge className={`text-xs font-medium ${STYLE[status]}`} variant="secondary">
      {status === "draft"  ? "Draft"  :
       status === "active" ? "Active" : "Closed"}
    </Badge>
  );
}
```

- [ ] **Step 6.3: Build `CampaignSettingsForm`**

`src/components/olympiad/admin/CampaignSettingsForm.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Lock, Loader2 } from "lucide-react";
import { formatOlympiadFee } from "@/lib/olympiad/money";
import { CampaignStatusPill } from "./CampaignStatusPill";
import {
  useUpsertOlympiadCampaign,
  type OlympiadCampaign,
  type OlympiadCampaignInput,
} from "@/hooks/olympiad/useOlympiadCampaign";

const DEFAULT_NEW: OlympiadCampaignInput = {
  campaign_year: new Date().getFullYear(),
  default_price_paise: 50000,
  gst_percent: 18,
  exam_duration_minutes: 90,
  questions_per_subject: 30,
  pin_expiry_minutes: 120,
  gold_threshold_percent: 85,
  silver_threshold_percent: 70,
  bronze_threshold_percent: 50,
  gstin: null,
  status: "draft",
  description: null,
};

export function CampaignSettingsForm({ campaign }: { campaign: OlympiadCampaign | null }) {
  const [draft, setDraft] = useState<OlympiadCampaignInput>(campaign ?? DEFAULT_NEW);
  useEffect(() => { if (campaign) setDraft(campaign); }, [campaign]);

  const upsert = useUpsertOlympiadCampaign();
  const fee = (() => {
    try { return formatOlympiadFee(draft.default_price_paise, draft.gst_percent); }
    catch { return null; }
  })();

  // Lock detection — UI hint only; the trigger enforces server-side.
  const locked = campaign?.status === "active";

  const update = <K extends keyof OlympiadCampaignInput>(k: K, v: OlympiadCampaignInput[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <form
      data-dirty={Object.keys(campaign ?? {}).length > 0 && JSON.stringify(draft) !== JSON.stringify(campaign) ? "true" : "false"}
      onSubmit={(e) => { e.preventDefault(); upsert.mutate(draft); }}
      className="surface-card frosted-shadow rounded-card p-5 sm:p-6 space-y-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Campaign</p>
          <h2 className="text-lg sm:text-xl font-semibold text-ink-900">
            {draft.campaign_year} Olympiad
          </h2>
        </div>
        <CampaignStatusPill status={draft.status} />
      </header>

      {locked && (
        <div className="flex items-start gap-2 text-xs text-ink-600 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 rounded-md">
          <Lock className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>Some fields lock once any school enrolls. Default price and per-school overrides stay editable.</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Campaign year">
          <Input type="number" value={draft.campaign_year}
            onChange={(e) => update("campaign_year", Number(e.target.value))}
            disabled={!!campaign}
            min={2024} max={2100} />
        </Field>
        <Field label="Default price (paise)" hint={fee ? fee.display : "Enter a value to see the GST breakdown"}>
          <Input type="number" value={draft.default_price_paise}
            onChange={(e) => update("default_price_paise", Number(e.target.value))}
            min={100} step={100} />
        </Field>
        <Field label="GST percent" lockHint={locked}>
          <Input type="number" value={draft.gst_percent}
            onChange={(e) => update("gst_percent", Number(e.target.value))}
            min={0} max={100} step={0.01} disabled={locked} />
        </Field>
        <Field label="Exam duration (minutes)" lockHint={locked}>
          <Input type="number" value={draft.exam_duration_minutes}
            onChange={(e) => update("exam_duration_minutes", Number(e.target.value))}
            min={1} disabled={locked} />
        </Field>
        <Field label="Questions per subject" lockHint={locked}>
          <Input type="number" value={draft.questions_per_subject}
            onChange={(e) => update("questions_per_subject", Number(e.target.value))}
            min={1} disabled={locked} />
        </Field>
        <Field label="PIN expiry (minutes)">
          <Input type="number" value={draft.pin_expiry_minutes}
            onChange={(e) => update("pin_expiry_minutes", Number(e.target.value))}
            min={1} />
        </Field>
        <Field label="Gold threshold (%)" lockHint={locked}>
          <Input type="number" value={draft.gold_threshold_percent}
            onChange={(e) => update("gold_threshold_percent", Number(e.target.value))}
            min={0} max={100} step={0.01} disabled={locked} />
        </Field>
        <Field label="Silver threshold (%)" lockHint={locked}>
          <Input type="number" value={draft.silver_threshold_percent}
            onChange={(e) => update("silver_threshold_percent", Number(e.target.value))}
            min={0} max={100} step={0.01} disabled={locked} />
        </Field>
        <Field label="Bronze threshold (%)" lockHint={locked}>
          <Input type="number" value={draft.bronze_threshold_percent}
            onChange={(e) => update("bronze_threshold_percent", Number(e.target.value))}
            min={0} max={100} step={0.01} disabled={locked} />
        </Field>
        <Field label="GSTIN">
          <Input value={draft.gstin ?? ""} onChange={(e) => update("gstin", e.target.value || null)} />
        </Field>
      </div>

      <Field label="Description">
        <Textarea value={draft.description ?? ""}
          onChange={(e) => update("description", e.target.value || null)} rows={3} />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          {draft.status === "draft" && (
            <Button type="button" variant="secondary"
              onClick={() => setDraft((d) => ({ ...d, status: "active" }))}>
              Set Active
            </Button>
          )}
          {draft.status === "active" && (
            <Button type="button" variant="outline"
              onClick={() => setDraft((d) => ({ ...d, status: "closed" }))}>
              Close Campaign
            </Button>
          )}
        </div>
        <Button type="submit" disabled={upsert.isPending}>
          {upsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}

function Field({ label, hint, lockHint, children }: {
  label: string; hint?: string; lockHint?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-ink-600 inline-flex items-center gap-1">
        {label}
        {lockHint && <Lock className="h-3 w-3 text-ink-500" />}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-ink-500">{hint}</p>}
    </div>
  );
}
```

- [ ] **Step 6.4: Wire `OlympiadCampaignTab`**

Replace the placeholder in `src/pages/admin/olympiad/OlympiadCampaignTab.tsx`:
```tsx
import { Loader2 } from "lucide-react";
import { useOlympiadCampaigns } from "@/hooks/olympiad/useOlympiadCampaign";
import { CampaignSettingsForm } from "@/components/olympiad/admin/CampaignSettingsForm";

export default function OlympiadCampaignTab() {
  const { data: campaigns, isLoading } = useOlympiadCampaigns();
  const currentYear = new Date().getFullYear();
  const current = campaigns?.find((c) => c.campaign_year === currentYear) ?? null;
  const history = (campaigns ?? []).filter((c) => c.campaign_year !== currentYear);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <CampaignSettingsForm campaign={current} />

      {history.length > 0 && (
        <section className="surface-card frosted-shadow rounded-card p-5 space-y-3">
          <header>
            <p className="eyebrow">History</p>
            <h3 className="text-base font-semibold text-ink-900">Past campaigns</h3>
          </header>
          <ul className="divide-y divide-surface-stroke">
            {history.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-ink-900 font-medium">{c.campaign_year} Olympiad</span>
                <span className="text-ink-500 capitalize">{c.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 6.5: Verify**

Run:
```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/ src/components/olympiad/ src/pages/admin/olympiad/OlympiadCampaignTab.tsx
npx vite build
```
Expected: all three exit 0.

- [ ] **Step 6.6: Smoke test**

`npm run dev` → log in as super_admin → `/admin/olympiad`. The Campaign tab should render the form pre-filled with defaults (₹500, 18% GST, 90 min, etc.). Edit price to ₹500 → hint should read `₹500 + 18% GST = ₹590`. Click Save → toast "Campaign saved" appears. Refresh — values persist.

- [ ] **Step 6.7: Commit**

```bash
git add src/hooks/olympiad/ src/components/olympiad/ src/pages/admin/olympiad/OlympiadCampaignTab.tsx src/lib/olympiad/
git commit -m "feat(olympiad): campaign settings form + upsert hook"
```

---

## Section B — Catalog content

Section B fills in Subjects, Topics, Questions (incl. CSV import), and Study Materials. Each task lands one drillable surface.

### Task 7: `useOlympiadSubjects` + Subjects tab + SubjectEditorSheet

**Files:**
- Create: `src/hooks/olympiad/useOlympiadSubjects.ts`
- Create: `src/components/olympiad/admin/SubjectListRow.tsx`
- Create: `src/components/olympiad/admin/SubjectEditorSheet.tsx`
- Modify: `src/pages/admin/olympiad/OlympiadSubjectsTab.tsx`

- [ ] **Step 7.1: Create the hook**

`src/hooks/olympiad/useOlympiadSubjects.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type OlympiadSubject = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  grade_level_ids: string[];
};

export function useOlympiadSubjects() {
  return useQuery({
    queryKey: ["olympiad", "subjects"],
    queryFn: async (): Promise<OlympiadSubject[]> => {
      const { data: subjects, error: e1 } = await supabase
        .from("oly_subjects")
        .select("id, name, description, status")
        .order("name");
      if (e1) throw e1;

      const ids = (subjects ?? []).map((s) => s.id);
      if (ids.length === 0) return [];

      const { data: links, error: e2 } = await supabase
        .from("oly_subject_classes")
        .select("subject_id, grade_level_id")
        .in("subject_id", ids);
      if (e2) throw e2;

      const byId = new Map<string, string[]>();
      for (const l of links ?? []) {
        const arr = byId.get(l.subject_id) ?? [];
        arr.push(l.grade_level_id);
        byId.set(l.subject_id, arr);
      }

      return (subjects ?? []).map((s) => ({
        ...s,
        grade_level_ids: byId.get(s.id) ?? [],
      })) as OlympiadSubject[];
    },
    staleTime: 60_000,
  });
}

export type OlympiadSubjectInput = {
  id?: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  grade_level_ids: string[];
};

export function useUpsertOlympiadSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OlympiadSubjectInput): Promise<string> => {
      let subjectId = input.id ?? "";
      if (subjectId) {
        const { error } = await supabase
          .from("oly_subjects")
          .update({ name: input.name, description: input.description, status: input.status })
          .eq("id", subjectId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("oly_subjects")
          .insert({ name: input.name, description: input.description, status: input.status })
          .select("id")
          .single();
        if (error) throw error;
        subjectId = data.id;
      }

      // Reconcile grade_level_ids — delete existing then insert provided set.
      const { error: delErr } = await supabase
        .from("oly_subject_classes")
        .delete()
        .eq("subject_id", subjectId);
      if (delErr) throw delErr;

      if (input.grade_level_ids.length > 0) {
        const rows = input.grade_level_ids.map((gid) => ({
          subject_id: subjectId,
          grade_level_id: gid,
        }));
        const { error: insErr } = await supabase.from("oly_subject_classes").insert(rows);
        if (insErr) throw insErr;
      }

      return subjectId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "subjects"] });
      toast.success("Subject saved");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't save subject.", context: "useUpsertOlympiadSubject" }),
  });
}
```

- [ ] **Step 7.2: Build `SubjectEditorSheet`**

`src/components/olympiad/admin/SubjectEditorSheet.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useUpsertOlympiadSubject,
  type OlympiadSubject,
} from "@/hooks/olympiad/useOlympiadSubjects";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject?: OlympiadSubject | null;
};

function useGradeLevels() {
  return useQuery({
    queryKey: ["grade-levels", "olympiad-applicable"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name, grade_number, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return (data ?? []).filter((g) => {
        const n = Number(g.grade_number);
        return Number.isFinite(n) && n >= 3 && n <= 10;
      });
    },
    staleTime: 5 * 60_000,
  });
}

export function SubjectEditorSheet({ open, onOpenChange, subject }: Props) {
  const { data: grades } = useGradeLevels();
  const upsert = useUpsertOlympiadSubject();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);

  useEffect(() => {
    if (subject) {
      setName(subject.name);
      setDescription(subject.description ?? "");
      setStatus(subject.status);
      setSelectedGrades(subject.grade_level_ids);
    } else {
      setName(""); setDescription(""); setStatus("active"); setSelectedGrades([]);
    }
  }, [subject, open]);

  const toggleGrade = (id: string, checked: boolean) =>
    setSelectedGrades((s) => (checked ? [...new Set([...s, id])] : s.filter((g) => g !== id)));

  const onSubmit = async () => {
    await upsert.mutateAsync({
      id: subject?.id,
      name: name.trim(),
      description: description.trim() || null,
      status,
      grade_level_ids: selectedGrades,
    });
    onOpenChange(false);
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={subject ? "Edit subject" : "New subject"}
      description="Subjects persist across campaign years."
    >
      <form
        data-dirty={name || description || selectedGrades.length ? "true" : "false"}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="space-y-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Applicable classes</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(grades ?? []).map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selectedGrades.includes(g.id)}
                  onCheckedChange={(v) => toggleGrade(g.id, !!v)}
                />
                <span>{g.grade_name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Status</Label>
          <select
            className="h-10 rounded-md border border-surface-stroke bg-surface-card px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as "active" | "archived")}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={!name.trim() || upsert.isPending}>
            {upsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </form>
    </MobileSheet>
  );
}
```

- [ ] **Step 7.3: Build `SubjectListRow`**

`src/components/olympiad/admin/SubjectListRow.tsx`:
```tsx
import { ChevronRight } from "lucide-react";
import { NavLink } from "react-router-dom";
import { type OlympiadSubject } from "@/hooks/olympiad/useOlympiadSubjects";

export function SubjectListRow({ subject, classCount }: { subject: OlympiadSubject; classCount: number }) {
  return (
    <NavLink
      to={`/admin/olympiad/subjects/${subject.id}`}
      className="flex items-center gap-3 px-4 py-3 surface-card frosted-shadow rounded-card hover:bg-surface-card/80 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-900 truncate">{subject.name}</p>
        <p className="text-xs text-ink-500 mt-0.5">
          {classCount} class{classCount === 1 ? "" : "es"} · {subject.status === "active" ? "Active" : "Archived"}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-ink-500 flex-shrink-0" />
    </NavLink>
  );
}
```

- [ ] **Step 7.4: Wire the Subjects tab**

Replace `src/pages/admin/olympiad/OlympiadSubjectsTab.tsx`:
```tsx
import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadSubjects } from "@/hooks/olympiad/useOlympiadSubjects";
import { SubjectListRow } from "@/components/olympiad/admin/SubjectListRow";
import { SubjectEditorSheet } from "@/components/olympiad/admin/SubjectEditorSheet";
import { Medal } from "lucide-react";

export default function OlympiadSubjectsTab() {
  const { data: subjects, isLoading } = useOlympiadSubjects();
  const [editorOpen, setEditorOpen] = useState(false);

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Subjects</p>
        <Button size="sm" onClick={() => setEditorOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New subject
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      ) : (subjects ?? []).length === 0 ? (
        <EmptyState
          icon={<Medal className="h-8 w-8 text-ink-500" />}
          title="No subjects yet"
          description="Add a subject to start building the question bank."
          action={
            <Button onClick={() => setEditorOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New subject
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {(subjects ?? []).map((s) => (
            <SubjectListRow key={s.id} subject={s} classCount={s.grade_level_ids.length} />
          ))}
        </div>
      )}

      <SubjectEditorSheet open={editorOpen} onOpenChange={setEditorOpen} subject={null} />
    </div>
  );
}
```

If `EmptyState` lives at a different path in this repo, adjust the import (CLAUDE.md §20a says `@/components/shared/surfaces`). If the prop names differ (`title` vs `headline`, etc.), match the existing signature.

- [ ] **Step 7.5: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadSubjects.ts src/components/olympiad/admin/ src/pages/admin/olympiad/OlympiadSubjectsTab.tsx
npx vite build
```
Expected: all exit 0.

```bash
git add src/hooks/olympiad/useOlympiadSubjects.ts src/components/olympiad/admin/SubjectListRow.tsx src/components/olympiad/admin/SubjectEditorSheet.tsx src/pages/admin/olympiad/OlympiadSubjectsTab.tsx
git commit -m "feat(olympiad): subjects catalog + editor sheet"
```

---

### Task 8: Subject detail shell + Topics sub-tab

**Files:**
- Modify: `src/pages/admin/olympiad/OlympiadSubjectDetailPage.tsx`
- Create: `src/hooks/olympiad/useOlympiadTopics.ts`
- Create: `src/components/olympiad/admin/TopicEditorSheet.tsx`
- Modify: `src/pages/admin/olympiad/OlympiadTopicsSubTab.tsx`

- [ ] **Step 8.1: Build the subject-detail shell with internal sub-tabs**

Replace `src/pages/admin/olympiad/OlympiadSubjectDetailPage.tsx`:
```tsx
import { NavLink, Outlet, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useOlympiadSubjects } from "@/hooks/olympiad/useOlympiadSubjects";

const SUB_TABS = [
  { label: "Topics",         to: ""               },
  { label: "Questions",      to: "questions"      },
  { label: "Study material", to: "study-material" },
] as const;

export default function OlympiadSubjectDetailPage() {
  const { subjectId } = useParams();
  const { data: subjects, isLoading } = useOlympiadSubjects();
  const subject = subjects?.find((s) => s.id === subjectId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
      </div>
    );
  }

  if (!subject) {
    return (
      <div className="py-6 text-sm text-ink-600">
        Subject not found. <NavLink to="/admin/olympiad/subjects" className="underline">Back to subjects</NavLink>.
      </div>
    );
  }

  return (
    <div className="space-y-4 py-4">
      <NavLink to="/admin/olympiad/subjects" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" />
        All subjects
      </NavLink>

      <header>
        <p className="eyebrow">Subject</p>
        <h2 className="text-xl font-semibold text-ink-900">{subject.name}</h2>
        {subject.description && (
          <p className="text-sm text-ink-600 mt-1">{subject.description}</p>
        )}
      </header>

      <nav className="-mx-4 px-4 flex gap-2 overflow-x-auto scrollbar-hide">
        {SUB_TABS.map((t) => (
          <NavLink
            key={t.label}
            end={t.to === ""}
            to={t.to}
            className={({ isActive }) =>
              `inline-flex items-center px-3.5 py-1.5 rounded-full whitespace-nowrap text-xs font-medium transition-colors ${
                isActive ? "bg-brand-primary text-white" : "bg-surface-card text-ink-700 hover:bg-surface-card/80"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ subject }} />
    </div>
  );
}
```

- [ ] **Step 8.2: Create the topics hook**

`src/hooks/olympiad/useOlympiadTopics.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type OlympiadTopic = {
  id: string;
  subject_id: string;
  grade_level_id: string;
  name: string;
  status: "active" | "archived";
  display_order: number;
};

export function useOlympiadTopics(subjectId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "topics", subjectId],
    queryFn: async (): Promise<OlympiadTopic[]> => {
      if (!subjectId) return [];
      const { data, error } = await supabase
        .from("oly_topics")
        .select("id, subject_id, grade_level_id, name, status, display_order")
        .eq("subject_id", subjectId)
        .order("display_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as OlympiadTopic[];
    },
    enabled: !!subjectId,
    staleTime: 60_000,
  });
}

export type OlympiadTopicInput = {
  id?: string;
  subject_id: string;
  grade_level_id: string;
  name: string;
  status?: "active" | "archived";
  display_order?: number;
};

export function useUpsertOlympiadTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OlympiadTopicInput) => {
      const payload = {
        subject_id: input.subject_id,
        grade_level_id: input.grade_level_id,
        name: input.name,
        status: input.status ?? "active",
        display_order: input.display_order ?? 0,
      };
      if (input.id) {
        const { error } = await supabase.from("oly_topics").update(payload).eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("oly_topics").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "topics", vars.subject_id] });
      toast.success("Topic saved");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't save topic.", context: "useUpsertOlympiadTopic" }),
  });
}
```

- [ ] **Step 8.3: Build `TopicEditorSheet`**

`src/components/olympiad/admin/TopicEditorSheet.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import {
  useUpsertOlympiadTopic,
  type OlympiadTopic,
} from "@/hooks/olympiad/useOlympiadTopics";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectId: string;
  gradeLevelId: string;
  topic?: OlympiadTopic | null;
};

export function TopicEditorSheet({ open, onOpenChange, subjectId, gradeLevelId, topic }: Props) {
  const upsert = useUpsertOlympiadTopic();
  const [name, setName] = useState("");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [status, setStatus] = useState<"active" | "archived">("active");

  useEffect(() => {
    if (topic) { setName(topic.name); setDisplayOrder(topic.display_order); setStatus(topic.status); }
    else { setName(""); setDisplayOrder(0); setStatus("active"); }
  }, [topic, open]);

  const onSubmit = async () => {
    await upsert.mutateAsync({
      id: topic?.id,
      subject_id: subjectId,
      grade_level_id: gradeLevelId,
      name: name.trim(),
      display_order: displayOrder,
      status,
    });
    onOpenChange(false);
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={topic ? "Edit topic" : "New topic"}
    >
      <form
        data-dirty={name ? "true" : "false"}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="space-y-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Topic name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Display order</Label>
            <Input type="number" value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Status</Label>
            <select
              className="h-10 rounded-md border border-surface-stroke bg-surface-card px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as "active" | "archived")}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={!name.trim() || upsert.isPending}>
            {upsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </form>
    </MobileSheet>
  );
}
```

- [ ] **Step 8.4: Build the Topics sub-tab**

Replace `src/pages/admin/olympiad/OlympiadTopicsSubTab.tsx`:
```tsx
import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Loader2, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadTopics, type OlympiadTopic } from "@/hooks/olympiad/useOlympiadTopics";
import { TopicEditorSheet } from "@/components/olympiad/admin/TopicEditorSheet";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type OlympiadSubject } from "@/hooks/olympiad/useOlympiadSubjects";

type Ctx = { subject: OlympiadSubject };

function useGradeLevelMap() {
  return useQuery({
    queryKey: ["grade-levels", "map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name, grade_number, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export default function OlympiadTopicsSubTab() {
  const { subject } = useOutletContext<Ctx>();
  const { data: topics, isLoading } = useOlympiadTopics(subject.id);
  const { data: grades } = useGradeLevelMap();
  const applicable = (grades ?? []).filter((g) => subject.grade_level_ids.includes(g.id));

  const [sheetState, setSheetState] = useState<{ open: boolean; gradeLevelId: string; topic: OlympiadTopic | null }>({
    open: false, gradeLevelId: "", topic: null,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
      </div>
    );
  }

  if (applicable.length === 0) {
    return (
      <EmptyState
        icon={null}
        title="No applicable classes"
        description="Edit the subject to choose at least one applicable class first."
      />
    );
  }

  return (
    <>
      <Accordion type="multiple" defaultValue={applicable.map((g) => g.id)}>
        {applicable.map((g) => {
          const byGrade = (topics ?? []).filter((t) => t.grade_level_id === g.id);
          return (
            <AccordionItem key={g.id} value={g.id}>
              <AccordionTrigger className="text-sm">
                <span className="flex-1 text-left">{g.grade_name}</span>
                <span className="text-xs text-ink-500 mr-2">{byGrade.length} topic{byGrade.length === 1 ? "" : "s"}</span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {byGrade.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-surface-card">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900 truncate">{t.name}</p>
                        <p className="text-[11px] text-ink-500">Order {t.display_order} · {t.status}</p>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() =>
                        setSheetState({ open: true, gradeLevelId: g.id, topic: t })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() =>
                    setSheetState({ open: true, gradeLevelId: g.id, topic: null })}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add topic
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <TopicEditorSheet
        open={sheetState.open}
        onOpenChange={(o) => setSheetState((s) => ({ ...s, open: o }))}
        subjectId={subject.id}
        gradeLevelId={sheetState.gradeLevelId}
        topic={sheetState.topic}
      />
    </>
  );
}
```

- [ ] **Step 8.5: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadTopics.ts src/components/olympiad/admin/TopicEditorSheet.tsx src/pages/admin/olympiad/OlympiadSubjectDetailPage.tsx src/pages/admin/olympiad/OlympiadTopicsSubTab.tsx
npx vite build
```
Expected: all exit 0.

```bash
git add src/hooks/olympiad/useOlympiadTopics.ts src/components/olympiad/admin/TopicEditorSheet.tsx src/pages/admin/olympiad/OlympiadSubjectDetailPage.tsx src/pages/admin/olympiad/OlympiadTopicsSubTab.tsx
git commit -m "feat(olympiad): subject detail shell + topics editor"
```

---

### Task 9: Question-bank hook + table + add/edit sheet

**Files:**
- Create: `src/hooks/olympiad/useOlympiadQuestionBank.ts`
- Create: `src/hooks/olympiad/useOlympiadQuestionUpsert.ts`
- Create: `src/hooks/olympiad/useOlympiadQuestionBulkAction.ts`
- Create: `src/components/olympiad/admin/QuestionEditorSheet.tsx`
- Create: `src/components/olympiad/admin/QuestionBankTable.tsx`

- [ ] **Step 9.1: Bank-view hook**

`src/hooks/olympiad/useOlympiadQuestionBank.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type BankQuestion = {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: "A" | "B" | "C" | "D";
  topic_id: string | null;
  topic_name: string | null;
  status: "active" | "inactive";
  times_used: number;
  total_correct: number;
  total_attempts: number;
  total_time_seconds: number;
  last_used_at: string | null;
  updated_at: string;
  avg_correct_rate_percent: number | null;
  avg_time_seconds: number | null;
};

export type BankFilters = {
  topicId?: string | null;
  status?: "active" | "inactive" | null;
};

export type BankSort = "last_used_desc" | "times_used_desc" | "avg_correct_rate_asc";

export function useOlympiadQuestionBank(
  subjectId: string | undefined,
  gradeLevelId: string | undefined,
  filters: BankFilters,
  sort: BankSort,
  page: number,
  pageSize = 25,
) {
  return useQuery({
    queryKey: ["olympiad", "question-bank", subjectId, gradeLevelId, filters, sort, page, pageSize],
    queryFn: async (): Promise<{ rows: BankQuestion[]; total: number }> => {
      if (!subjectId || !gradeLevelId) return { rows: [], total: 0 };
      const { data, error } = await supabase.rpc("oly_question_bank_view", {
        p_subject_id: subjectId,
        p_grade_level_id: gradeLevelId,
        p_topic_id: filters.topicId ?? null,
        p_status: filters.status ?? null,
        p_sort: sort,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      const payload = (data ?? {}) as { rows?: BankQuestion[]; total?: number };
      return { rows: payload.rows ?? [], total: payload.total ?? 0 };
    },
    enabled: !!subjectId && !!gradeLevelId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 9.2: Upsert hook**

`src/hooks/olympiad/useOlympiadQuestionUpsert.ts`:
```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type QuestionUpsertInput = {
  id?: string;
  subject_id: string;
  grade_level_id: string;
  topic_id: string | null;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: "A" | "B" | "C" | "D";
  internal_notes: string | null;
  status: "active" | "inactive";
};

export function useOlympiadQuestionUpsert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: QuestionUpsertInput) => {
      const { data, error } = await supabase.rpc("oly_questions_upsert", { p_payload: input });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "question-bank", vars.subject_id, vars.grade_level_id] });
      toast.success("Question saved");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't save question.", context: "useOlympiadQuestionUpsert" }),
  });
}
```

- [ ] **Step 9.3: Bulk-action hook**

`src/hooks/olympiad/useOlympiadQuestionBulkAction.ts`:
```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useOlympiadQuestionBulkAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: "active" | "inactive" }) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("oly_questions")
        .update({ status })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "question-bank"] });
      toast.success(`${vars.ids.length} question${vars.ids.length === 1 ? "" : "s"} updated`);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update questions.", context: "useOlympiadQuestionBulkAction" }),
  });
}
```

- [ ] **Step 9.4: `QuestionEditorSheet` with live KaTeX preview**

`src/components/olympiad/admin/QuestionEditorSheet.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { MathPreview } from "@/components/ui/math-preview";
import {
  useOlympiadQuestionUpsert,
  type QuestionUpsertInput,
} from "@/hooks/olympiad/useOlympiadQuestionUpsert";
import { useOlympiadTopics } from "@/hooks/olympiad/useOlympiadTopics";
import type { BankQuestion } from "@/hooks/olympiad/useOlympiadQuestionBank";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectId: string;
  gradeLevelId: string;
  initial?: BankQuestion | null;
};

const EMPTY = {
  question_text: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  correct_answer: "A" as const,
  topic_id: null as string | null,
  internal_notes: null as string | null,
  status: "active" as const,
};

export function QuestionEditorSheet({ open, onOpenChange, subjectId, gradeLevelId, initial }: Props) {
  const upsert = useOlympiadQuestionUpsert();
  const { data: topics } = useOlympiadTopics(subjectId);
  const topicsForGrade = (topics ?? []).filter((t) => t.grade_level_id === gradeLevelId && t.status === "active");

  const [draft, setDraft] = useState(EMPTY);

  useEffect(() => {
    if (initial) {
      setDraft({
        question_text: initial.question_text,
        option_a: initial.option_a,
        option_b: initial.option_b,
        option_c: initial.option_c,
        option_d: initial.option_d,
        correct_answer: initial.correct_answer,
        topic_id: initial.topic_id,
        internal_notes: null,
        status: initial.status,
      });
    } else {
      setDraft(EMPTY);
    }
  }, [initial, open]);

  const update = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const onSubmit = async () => {
    const payload: QuestionUpsertInput = {
      id: initial?.id,
      subject_id: subjectId,
      grade_level_id: gradeLevelId,
      topic_id: draft.topic_id,
      question_text: draft.question_text.trim(),
      option_a: draft.option_a.trim(),
      option_b: draft.option_b.trim(),
      option_c: draft.option_c.trim(),
      option_d: draft.option_d.trim(),
      correct_answer: draft.correct_answer,
      internal_notes: draft.internal_notes,
      status: draft.status,
    };
    await upsert.mutateAsync(payload);
    onOpenChange(false);
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Edit question" : "New question"}
      description="Use $...$ for inline KaTeX, $$...$$ for block math."
    >
      <form
        data-dirty={draft.question_text || draft.option_a ? "true" : "false"}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="space-y-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Question</Label>
          <Textarea
            value={draft.question_text}
            onChange={(e) => update("question_text", e.target.value)}
            rows={4}
            required
            placeholder="e.g. Solve for $x$: $x^2 + 2x - 3 = 0$"
          />
          {draft.question_text && (
            <div className="rounded-md border border-surface-stroke bg-surface-card p-3">
              <p className="eyebrow mb-2">Preview</p>
              <MathPreview text={draft.question_text} />
            </div>
          )}
        </div>

        {(["A", "B", "C", "D"] as const).map((letter) => {
          const key = `option_${letter.toLowerCase()}` as keyof typeof draft;
          return (
            <div key={letter} className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">Option {letter}</Label>
              <Input
                value={draft[key] as string}
                onChange={(e) => update(key, e.target.value as never)}
                required
              />
              {(draft[key] as string) && (
                <div className="rounded-md border border-surface-stroke bg-surface-card p-2">
                  <MathPreview text={draft[key] as string} />
                </div>
              )}
            </div>
          );
        })}

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Correct answer</Label>
            <select
              className="h-10 rounded-md border border-surface-stroke bg-surface-card px-3 text-sm"
              value={draft.correct_answer}
              onChange={(e) => update("correct_answer", e.target.value as "A" | "B" | "C" | "D")}
            >
              {(["A", "B", "C", "D"] as const).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Topic</Label>
            <select
              className="h-10 rounded-md border border-surface-stroke bg-surface-card px-3 text-sm"
              value={draft.topic_id ?? ""}
              onChange={(e) => update("topic_id", e.target.value || null)}
            >
              <option value="">No topic</option>
              {topicsForGrade.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Internal notes (super-admin only)</Label>
          <Textarea
            value={draft.internal_notes ?? ""}
            onChange={(e) => update("internal_notes", e.target.value || null)}
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </form>
    </MobileSheet>
  );
}
```

If `MathPreview`'s actual prop is named differently (e.g. `content` instead of `text`), match the existing signature — check `src/components/ui/math-preview.tsx`.

- [ ] **Step 9.5: `QuestionBankTable`**

`src/components/olympiad/admin/QuestionBankTable.tsx`:
```tsx
import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MathPreview } from "@/components/ui/math-preview";
import {
  useOlympiadQuestionBank,
  type BankFilters,
  type BankSort,
  type BankQuestion,
} from "@/hooks/olympiad/useOlympiadQuestionBank";
import { useOlympiadQuestionBulkAction } from "@/hooks/olympiad/useOlympiadQuestionBulkAction";
import { QuestionEditorSheet } from "./QuestionEditorSheet";

type Props = {
  subjectId: string;
  gradeLevelId: string;
};

export function QuestionBankTable({ subjectId, gradeLevelId }: Props) {
  const [filters, setFilters] = useState<BankFilters>({ topicId: null, status: null });
  const [sort, setSort] = useState<BankSort>("last_used_desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const { data, isLoading } = useOlympiadQuestionBank(subjectId, gradeLevelId, filters, sort, page, pageSize);
  const bulk = useOlympiadQuestionBulkAction();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<BankQuestion | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-full border border-surface-stroke bg-surface-card px-3 text-xs"
          value={filters.status ?? ""}
          onChange={(e) => { setFilters((f) => ({ ...f, status: (e.target.value || null) as BankFilters["status"] })); setPage(1); }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <select
          className="h-9 rounded-full border border-surface-stroke bg-surface-card px-3 text-xs"
          value={sort}
          onChange={(e) => { setSort(e.target.value as BankSort); setPage(1); }}
        >
          <option value="last_used_desc">Last used (recent)</option>
          <option value="times_used_desc">Times used (high)</option>
          <option value="avg_correct_rate_asc">Avg correct rate (low)</option>
        </select>

        {selected.size > 0 && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline"
              onClick={() => bulk.mutate({ ids: Array.from(selected), status: "inactive" })}>
              Deactivate {selected.size}
            </Button>
            <Button size="sm" variant="outline"
              onClick={() => bulk.mutate({ ids: Array.from(selected), status: "active" })}>
              Activate {selected.size}
            </Button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 py-6 text-center">No questions match these filters.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((q) => (
            <li key={q.id} className="flex items-start gap-3 px-3 py-3 surface-card frosted-shadow rounded-card">
              <Checkbox
                checked={selected.has(q.id)}
                onCheckedChange={(v) => toggle(q.id, !!v)}
              />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="line-clamp-2 text-sm text-ink-900">
                  <MathPreview text={q.question_text} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
                  {q.topic_name && <Badge variant="secondary" className="text-[10px]">{q.topic_name}</Badge>}
                  <span>Correct: {q.correct_answer}</span>
                  <span>·</span>
                  <span>Used {q.times_used}x</span>
                  {q.avg_correct_rate_percent != null && (
                    <>
                      <span>·</span>
                      <span>{q.avg_correct_rate_percent}% correct</span>
                    </>
                  )}
                  <span className="ml-auto">{q.status}</span>
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => { setEditing(q); setSheetOpen(true); }}>
                <Pencil className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-between text-xs text-ink-600 pt-2">
          <span>Page {page} of {totalPages} ({total} questions)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <QuestionEditorSheet
        open={sheetOpen}
        onOpenChange={(o) => { setSheetOpen(o); if (!o) setEditing(null); }}
        subjectId={subjectId}
        gradeLevelId={gradeLevelId}
        initial={editing}
      />
    </div>
  );
}
```

- [ ] **Step 9.6: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/ src/components/olympiad/admin/QuestionBankTable.tsx src/components/olympiad/admin/QuestionEditorSheet.tsx
npx vite build
```
Expected: all exit 0.

```bash
git add src/hooks/olympiad/useOlympiadQuestionBank.ts src/hooks/olympiad/useOlympiadQuestionUpsert.ts src/hooks/olympiad/useOlympiadQuestionBulkAction.ts src/components/olympiad/admin/QuestionEditorSheet.tsx src/components/olympiad/admin/QuestionBankTable.tsx
git commit -m "feat(olympiad): question bank table + editor sheet"
```

---

### Task 10: CSV import — helpers + edge function + sheet UI

**Files:**
- Create: `src/lib/olympiad/csv.ts`
- Create: `supabase/functions/oly-question-csv-import/index.ts`
- Create: `src/components/olympiad/admin/QuestionCsvImportSheet.tsx`

- [ ] **Step 10.1: CSV parse + validate helpers**

`src/lib/olympiad/csv.ts`:
```ts
import Papa from "papaparse";

export type CsvQuestionRow = {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  topic: string;
};

export type CsvImportRow = {
  rowNumber: number;
  raw: CsvQuestionRow;
  errors: string[];
};

const REQUIRED_COLUMNS: (keyof CsvQuestionRow)[] = [
  "question_text", "option_a", "option_b", "option_c", "option_d", "correct_answer", "topic",
];

export function downloadCsvTemplate() {
  const csv = "question_text,option_a,option_b,option_c,option_d,correct_answer,topic\n" +
    "\"What is $1 + 1$?\",\"1\",\"2\",\"3\",\"4\",B,Arithmetic\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "olympiad-questions-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export async function parseCsv(file: File): Promise<CsvImportRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = (result.data ?? []).map((raw, i) => validateRow(raw as CsvQuestionRow, i + 2));
        resolve(rows);
      },
      error: (err) => reject(err),
    });
  });
}

function validateRow(raw: CsvQuestionRow, rowNumber: number): CsvImportRow {
  const errors: string[] = [];
  for (const col of REQUIRED_COLUMNS) {
    if (!raw[col] || String(raw[col]).trim() === "") {
      errors.push(`Missing required column: ${col}`);
    }
  }
  if (raw.correct_answer && !["A", "B", "C", "D"].includes(String(raw.correct_answer).trim().toUpperCase())) {
    errors.push(`correct_answer must be A, B, C, or D (got "${raw.correct_answer}")`);
  }
  return { rowNumber, raw, errors };
}

export function validateAgainstTopics(
  rows: CsvImportRow[],
  validTopics: { id: string; name: string }[],
): CsvImportRow[] {
  const byLowerName = new Map(validTopics.map((t) => [t.name.toLowerCase(), t.id]));
  return rows.map((r) => {
    if (r.errors.length > 0) return r;
    if (r.raw.topic && !byLowerName.has(r.raw.topic.toLowerCase())) {
      return { ...r, errors: [`Topic "${r.raw.topic}" not found in this subject × class`] };
    }
    return r;
  });
}

export function rowsToPayload(
  rows: CsvImportRow[],
  topicLookup: Map<string, string>,
  subjectId: string,
  gradeLevelId: string,
) {
  return rows
    .filter((r) => r.errors.length === 0)
    .map((r) => ({
      subject_id: subjectId,
      grade_level_id: gradeLevelId,
      topic_id: topicLookup.get(r.raw.topic.toLowerCase()) ?? null,
      question_text: r.raw.question_text,
      option_a: r.raw.option_a,
      option_b: r.raw.option_b,
      option_c: r.raw.option_c,
      option_d: r.raw.option_d,
      correct_answer: r.raw.correct_answer.trim().toUpperCase(),
      status: "active",
    }));
}
```

- [ ] **Step 10.2: Edge function for transactional bulk insert**

`supabase/functions/oly-question-csv-import/index.ts`:
```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  rows: Array<{
    subject_id: string;
    grade_level_id: string;
    topic_id: string | null;
    question_text: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    correct_answer: "A" | "B" | "C" | "D";
    status: "active" | "inactive";
  }>;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json({ error: "Missing auth" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify caller is super_admin via the helper.
    const { data: roleCheck, error: roleErr } = await supabase.rpc("is_super_admin", {
      user_id: (await supabase.auth.getUser(authHeader.replace("Bearer ", ""))).data.user?.id,
    });
    if (roleErr) return json({ error: roleErr.message }, 400);
    if (!roleCheck) return json({ error: "Forbidden" }, 403);

    const { rows } = (await req.json()) as Payload;
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ error: "No rows provided" }, 400);
    }
    if (rows.length > 500) {
      return json({ error: "Maximum 500 rows per import" }, 400);
    }

    const insertRows = rows.map((r) => ({
      subject_id: r.subject_id,
      grade_level_id: r.grade_level_id,
      topic_id: r.topic_id,
      question_text: r.question_text,
      option_a: r.option_a,
      option_b: r.option_b,
      option_c: r.option_c,
      option_d: r.option_d,
      correct_answer: r.correct_answer,
      status: r.status,
    }));

    const { data, error } = await supabase
      .from("oly_questions")
      .insert(insertRows)
      .select("id");

    if (error) return json({ error: error.message }, 400);

    return json({ inserted_count: data?.length ?? 0 }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 10.3: Deploy the edge function**

Run:
```bash
npx supabase@latest functions deploy oly-question-csv-import --project-ref gyymkgohcijeksmrzuyw
```
Expected: success message. If the project-ref differs, use the one from `supabase/config.toml`.

- [ ] **Step 10.4: `QuestionCsvImportSheet`**

`src/components/olympiad/admin/QuestionCsvImportSheet.tsx`:
```tsx
import { useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import {
  downloadCsvTemplate,
  parseCsv,
  validateAgainstTopics,
  rowsToPayload,
  type CsvImportRow,
} from "@/lib/olympiad/csv";
import { useOlympiadTopics } from "@/hooks/olympiad/useOlympiadTopics";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectId: string;
  gradeLevelId: string;
};

export function QuestionCsvImportSheet({ open, onOpenChange, subjectId, gradeLevelId }: Props) {
  const queryClient = useQueryClient();
  const { data: topics } = useOlympiadTopics(subjectId);
  const validTopics = (topics ?? []).filter((t) => t.grade_level_id === gradeLevelId);
  const [parsedRows, setParsedRows] = useState<CsvImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const parsed = await parseCsv(file);
      const validated = validateAgainstTopics(parsed, validTopics);
      setParsedRows(validated);
    } catch (e) {
      toastError(e as Error, { fallback: "Couldn't parse CSV.", context: "QuestionCsvImportSheet.parseCsv" });
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    if (!parsedRows) return;
    const validRows = parsedRows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) {
      toast.warning("No valid rows to import");
      return;
    }
    setBusy(true);
    try {
      const topicLookup = new Map(validTopics.map((t) => [t.name.toLowerCase(), t.id]));
      const payload = rowsToPayload(validRows, topicLookup, subjectId, gradeLevelId);
      const { data, error } = await supabase.functions.invoke("oly-question-csv-import", {
        body: { rows: payload },
      });
      if (error) throw new Error(error.message);
      const count = (data as { inserted_count?: number })?.inserted_count ?? 0;
      toast.success(`Imported ${count} question${count === 1 ? "" : "s"}`);
      queryClient.invalidateQueries({ queryKey: ["olympiad", "question-bank", subjectId, gradeLevelId] });
      setParsedRows(null);
      onOpenChange(false);
    } catch (e) {
      toastError(e as Error, { fallback: "Couldn't import questions.", context: "QuestionCsvImportSheet.onImport" });
    } finally {
      setBusy(false);
    }
  };

  const validCount = parsedRows?.filter((r) => r.errors.length === 0).length ?? 0;
  const invalidCount = parsedRows?.filter((r) => r.errors.length > 0).length ?? 0;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Bulk import questions"
      description="Upload a CSV of questions for this subject and class."
    >
      <div className="space-y-4">
        <Button variant="outline" type="button" onClick={downloadCsvTemplate}>
          <Download className="h-4 w-4 mr-2" />
          Download template
        </Button>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">CSV file</Label>
          <Input
            type="file"
            accept=".csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            disabled={busy}
          />
        </div>

        {parsedRows && (
          <section className="space-y-2">
            <p className="text-sm text-ink-700">
              {validCount} valid · {invalidCount} invalid
            </p>
            {invalidCount > 0 && (
              <ul className="max-h-48 overflow-auto text-[11px] space-y-1 border border-surface-stroke rounded-md p-2 bg-surface-card">
                {parsedRows.filter((r) => r.errors.length > 0).map((r) => (
                  <li key={r.rowNumber}>
                    <span className="font-medium">Row {r.rowNumber}:</span> {r.errors.join("; ")}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={busy || validCount === 0} onClick={onImport}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Upload className="h-4 w-4 mr-1" />
            Import {validCount > 0 ? validCount : ""} valid row{validCount === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </MobileSheet>
  );
}
```

- [ ] **Step 10.5: Wire the Questions sub-tab**

Replace `src/pages/admin/olympiad/OlympiadQuestionsSubTab.tsx`:
```tsx
import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Loader2, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type OlympiadSubject } from "@/hooks/olympiad/useOlympiadSubjects";
import { QuestionBankTable } from "@/components/olympiad/admin/QuestionBankTable";
import { QuestionEditorSheet } from "@/components/olympiad/admin/QuestionEditorSheet";
import { QuestionCsvImportSheet } from "@/components/olympiad/admin/QuestionCsvImportSheet";

type Ctx = { subject: OlympiadSubject };

function useGradeLevelMap() {
  return useQuery({
    queryKey: ["grade-levels", "map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels").select("id, grade_name, grade_number, display_order")
        .eq("is_active", true).order("display_order");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export default function OlympiadQuestionsSubTab() {
  const { subject } = useOutletContext<Ctx>();
  const { data: grades, isLoading } = useGradeLevelMap();
  const applicable = (grades ?? []).filter((g) => subject.grade_level_ids.includes(g.id));

  const [addOpen, setAddOpen] = useState<{ gradeId: string } | null>(null);
  const [csvOpen, setCsvOpen] = useState<{ gradeId: string } | null>(null);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }

  if (applicable.length === 0) {
    return <p className="text-sm text-ink-600 py-6 text-center">Edit the subject to choose at least one applicable class first.</p>;
  }

  return (
    <Accordion type="multiple" defaultValue={[applicable[0]?.id]}>
      {applicable.map((g) => (
        <AccordionItem key={g.id} value={g.id}>
          <AccordionTrigger className="text-sm">{g.grade_name}</AccordionTrigger>
          <AccordionContent>
            <div className="flex justify-end gap-2 mb-3">
              <Button size="sm" variant="outline" onClick={() => setCsvOpen({ gradeId: g.id })}>
                <Upload className="h-4 w-4 mr-1" />
                CSV import
              </Button>
              <Button size="sm" onClick={() => setAddOpen({ gradeId: g.id })}>
                <Plus className="h-4 w-4 mr-1" />
                Add question
              </Button>
            </div>
            <QuestionBankTable subjectId={subject.id} gradeLevelId={g.id} />

            <QuestionEditorSheet
              open={addOpen?.gradeId === g.id}
              onOpenChange={(o) => !o && setAddOpen(null)}
              subjectId={subject.id}
              gradeLevelId={g.id}
              initial={null}
            />
            <QuestionCsvImportSheet
              open={csvOpen?.gradeId === g.id}
              onOpenChange={(o) => !o && setCsvOpen(null)}
              subjectId={subject.id}
              gradeLevelId={g.id}
            />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
```

- [ ] **Step 10.6: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/lib/olympiad/csv.ts src/components/olympiad/admin/QuestionCsvImportSheet.tsx src/pages/admin/olympiad/OlympiadQuestionsSubTab.tsx
npx vite build
```
Expected: all exit 0.

```bash
git add src/lib/olympiad/csv.ts supabase/functions/oly-question-csv-import/ src/components/olympiad/admin/QuestionCsvImportSheet.tsx src/pages/admin/olympiad/OlympiadQuestionsSubTab.tsx
git commit -m "feat(olympiad): question CSV import with row-level validation"
```

---

### Task 11: Study materials — hook + upload sheets + sub-tab

**Files:**
- Create: `src/hooks/olympiad/useOlympiadStudyMaterials.ts`
- Create: `src/components/olympiad/admin/StudyMaterialUploadSheet.tsx`
- Create: `src/components/olympiad/admin/StudyMaterialListRow.tsx`
- Modify: `src/pages/admin/olympiad/OlympiadStudyMaterialSubTab.tsx`

- [ ] **Step 11.1: Hook**

`src/hooks/olympiad/useOlympiadStudyMaterials.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

const BUCKET = "olympiad-study-material";
const MAX_BYTES = 10 * 1024 * 1024;

export type StudyMaterial = {
  id: string;
  subject_id: string;
  grade_level_id: string;
  title: string;
  description: string | null;
  storage_path: string;
  file_size_bytes: number;
  display_order: number;
  created_at: string;
};

export function useOlympiadStudyMaterials(subjectId: string | undefined, gradeLevelId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "study-materials", subjectId, gradeLevelId],
    queryFn: async (): Promise<StudyMaterial[]> => {
      if (!subjectId || !gradeLevelId) return [];
      const { data, error } = await supabase
        .from("oly_study_materials")
        .select("id, subject_id, grade_level_id, title, description, storage_path, file_size_bytes, display_order, created_at")
        .eq("subject_id", subjectId)
        .eq("grade_level_id", gradeLevelId)
        .order("display_order")
        .order("title");
      if (error) throw error;
      return (data ?? []) as StudyMaterial[];
    },
    enabled: !!subjectId && !!gradeLevelId,
    staleTime: 60_000,
  });
}

export function useUploadStudyMaterial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      subjectId: string;
      gradeLevelId: string;
      title: string;
      description: string | null;
      displayOrder: number;
      file: File;
    }) => {
      if (input.file.size > MAX_BYTES) throw new Error("File exceeds 10 MB limit");
      if (input.file.type !== "application/pdf") throw new Error("Only PDF files are accepted");

      const path = `${input.subjectId}/${input.gradeLevelId}/${Date.now()}-${input.file.name}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("oly_study_materials").insert({
        subject_id: input.subjectId,
        grade_level_id: input.gradeLevelId,
        title: input.title,
        description: input.description,
        storage_path: path,
        file_size_bytes: input.file.size,
        display_order: input.displayOrder,
      });
      if (insErr) throw insErr;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "study-materials", vars.subjectId, vars.gradeLevelId] });
      toast.success("Study material uploaded");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't upload material.", context: "useUploadStudyMaterial" }),
  });
}

export function useDeleteStudyMaterial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string }) => {
      const { error: storErr } = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (storErr) throw storErr;
      const { error: dbErr } = await supabase.from("oly_study_materials").delete().eq("id", id);
      if (dbErr) throw dbErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "study-materials"] });
      toast.success("Material deleted");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't delete material.", context: "useDeleteStudyMaterial" }),
  });
}

export async function getStudyMaterialSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}
```

- [ ] **Step 11.2: Upload sheet**

`src/components/olympiad/admin/StudyMaterialUploadSheet.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useUploadStudyMaterial } from "@/hooks/olympiad/useOlympiadStudyMaterials";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectId: string;
  gradeLevelId: string;
};

export function StudyMaterialUploadSheet({ open, onOpenChange, subjectId, gradeLevelId }: Props) {
  const upload = useUploadStudyMaterial();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) { setTitle(""); setDescription(""); setDisplayOrder(0); setFile(null); }
  }, [open]);

  const onSubmit = async () => {
    if (!file) return;
    await upload.mutateAsync({
      subjectId, gradeLevelId,
      title: title.trim(),
      description: description.trim() || null,
      displayOrder,
      file,
    });
    onOpenChange(false);
  };

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Upload study material">
      <form
        data-dirty={title || description || file ? "true" : "false"}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="space-y-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Display order</Label>
            <Input type="number" value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">PDF (max 10 MB)</Label>
            <Input type="file" accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={!title.trim() || !file || upload.isPending}>
            {upload.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Upload
          </Button>
        </div>
      </form>
    </MobileSheet>
  );
}
```

- [ ] **Step 11.3: List row**

`src/components/olympiad/admin/StudyMaterialListRow.tsx`:
```tsx
import { Download, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useDeleteStudyMaterial,
  getStudyMaterialSignedUrl,
  type StudyMaterial,
} from "@/hooks/olympiad/useOlympiadStudyMaterials";
import { useState } from "react";

export function StudyMaterialListRow({ material }: { material: StudyMaterial }) {
  const del = useDeleteStudyMaterial();
  const [busy, setBusy] = useState(false);

  const onDownload = async () => {
    setBusy(true);
    try {
      const url = await getStudyMaterialSignedUrl(material.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  };

  const sizeMb = (material.file_size_bytes / (1024 * 1024)).toFixed(2);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 surface-card frosted-shadow rounded-card">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-900 truncate">{material.title}</p>
        <p className="text-[11px] text-ink-500">
          Order {material.display_order} · {sizeMb} MB
          {material.description ? ` · ${material.description}` : ""}
        </p>
      </div>
      <Button size="icon" variant="ghost" onClick={onDownload} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </Button>
      <Button size="icon" variant="ghost"
        onClick={() => { if (confirm("Delete this material?")) del.mutate({ id: material.id, storagePath: material.storage_path }); }}
        disabled={del.isPending}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 11.4: Sub-tab**

Replace `src/pages/admin/olympiad/OlympiadStudyMaterialSubTab.tsx`:
```tsx
import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type OlympiadSubject } from "@/hooks/olympiad/useOlympiadSubjects";
import { useOlympiadStudyMaterials } from "@/hooks/olympiad/useOlympiadStudyMaterials";
import { StudyMaterialListRow } from "@/components/olympiad/admin/StudyMaterialListRow";
import { StudyMaterialUploadSheet } from "@/components/olympiad/admin/StudyMaterialUploadSheet";

type Ctx = { subject: OlympiadSubject };

function useGradeLevelMap() {
  return useQuery({
    queryKey: ["grade-levels", "map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels").select("id, grade_name, grade_number, display_order")
        .eq("is_active", true).order("display_order");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

function MaterialsForGrade({ subjectId, gradeLevelId }: { subjectId: string; gradeLevelId: string }) {
  const { data: materials, isLoading } = useOlympiadStudyMaterials(subjectId, gradeLevelId);
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Upload material
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      ) : (materials ?? []).length === 0 ? (
        <p className="text-sm text-ink-500 py-4 text-center">No materials uploaded for this class yet.</p>
      ) : (
        <div className="space-y-2">
          {(materials ?? []).map((m) => <StudyMaterialListRow key={m.id} material={m} />)}
        </div>
      )}
      <StudyMaterialUploadSheet open={open} onOpenChange={setOpen} subjectId={subjectId} gradeLevelId={gradeLevelId} />
    </div>
  );
}

export default function OlympiadStudyMaterialSubTab() {
  const { subject } = useOutletContext<Ctx>();
  const { data: grades, isLoading } = useGradeLevelMap();
  const applicable = (grades ?? []).filter((g) => subject.grade_level_ids.includes(g.id));

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  if (applicable.length === 0) return <p className="text-sm text-ink-600 py-6 text-center">Edit the subject to choose at least one applicable class first.</p>;

  return (
    <Accordion type="multiple" defaultValue={[applicable[0]?.id]}>
      {applicable.map((g) => (
        <AccordionItem key={g.id} value={g.id}>
          <AccordionTrigger className="text-sm">{g.grade_name}</AccordionTrigger>
          <AccordionContent>
            <MaterialsForGrade subjectId={subject.id} gradeLevelId={g.id} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
```

- [ ] **Step 11.5: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadStudyMaterials.ts src/components/olympiad/admin/StudyMaterialUploadSheet.tsx src/components/olympiad/admin/StudyMaterialListRow.tsx src/pages/admin/olympiad/OlympiadStudyMaterialSubTab.tsx
npx vite build
```
Expected: all exit 0.

```bash
git add src/hooks/olympiad/useOlympiadStudyMaterials.ts src/components/olympiad/admin/StudyMaterialUploadSheet.tsx src/components/olympiad/admin/StudyMaterialListRow.tsx src/pages/admin/olympiad/OlympiadStudyMaterialSubTab.tsx
git commit -m "feat(olympiad): study material upload + list per (subject, class)"
```

---

## Section C — Schools tab + final verification

### Task 12: Schools tab (empty state + disabled CTA)

**Files:**
- Modify: `src/pages/admin/olympiad/OlympiadSchoolsTab.tsx`

- [ ] **Step 12.1: Implement the empty state**

Replace the placeholder:
```tsx
import { Medal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";

export default function OlympiadSchoolsTab() {
  return (
    <div className="py-6">
      <EmptyState
        icon={<Medal className="h-8 w-8 text-ink-500" />}
        title="No schools onboarded yet"
        description="Use Onboard New School to add the first one. The onboarding form ships in Phase 2."
        action={
          <Button
            disabled
            title="Onboarding form ships in Phase 2"
            className="cursor-not-allowed opacity-60"
          >
            Onboard new school
          </Button>
        }
      />
    </div>
  );
}
```

- [ ] **Step 12.2: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/pages/admin/olympiad/OlympiadSchoolsTab.tsx
npx vite build
```
Expected: all exit 0.

```bash
git add src/pages/admin/olympiad/OlympiadSchoolsTab.tsx
git commit -m "feat(olympiad): schools tab empty state (form ships in phase 2)"
```

---

### Task 13: Full §5a contract sweep + manual smoke

**Files:** none directly — this is a verification gate.

- [ ] **Step 13.1: Run the full §5a contract**

```bash
npx tsc --noEmit
```
Expected: exit 0. If any errors appear in touched files, fix them. Errors in unrelated files are out of scope per CLAUDE.md §5a.

```bash
npx eslint "src/{hooks,components,pages,lib}/olympiad/**" "src/App.tsx" "src/components/admin/institution-wizard/featuresData.ts" "src/components/layout/AppSidebar.tsx" "src/pages/admin/olympiad/**"
```
Expected: exit 0. Any new error means a touched file is dirty — fix inline.

```bash
npx vite build
```
Expected: exit 0. Bundle warnings about chunk size are not failures unless exit code is non-zero.

- [ ] **Step 13.2: Manual smoke — light mode at 375 px**

Run `npm run dev`. In Chrome DevTools, set viewport to iPhone SE (375 px). Log in as a super_admin user. Walk through:

1. Sidebar shows "Olympiad" with Medal icon. Tap → lands on `/admin/olympiad`.
2. Campaign tab renders the form. Create the 2026 campaign with default values. Toast "Campaign saved" appears.
3. Tap "Subjects" tab → empty state with "New subject" button. Create "Mathematics" applicable to Class 3-10.
4. Tap the new Subject row → Subject detail page opens with Topics / Questions / Study material sub-tabs.
5. Topics: add 3 topics for Class 8 (Algebra, Geometry, Arithmetic).
6. Questions: tap Class 8 accordion → Add question → fill in `Solve for $x$: $x^2 - 1 = 0$`, options `0, 1, ±1, 2`, correct C, topic Algebra. KaTeX preview renders inline. Save.
7. Open the bank table again — the question appears with `±1` answer and Algebra tag.
8. CSV import: download template → confirm it has the right columns. Upload a 3-row CSV → preview shows row-level validation. Import.
9. Study material: upload a small PDF to Class 8. Confirm it appears, download button works, delete works.
10. Tap "Schools" tab → empty state with disabled CTA showing the tooltip.

- [ ] **Step 13.3: Manual smoke — dark mode + 375 px**

Toggle dark mode via the theme switcher. Repeat the path. Confirm:
- Sidebar background flips to dark slate
- Page backdrop flips (no cream surface)
- Cards float visibly with the new shadow tokens
- KaTeX preview text remains readable (white on dark or grey on dark)
- No element stays cream / white incorrectly

If anything looks wrong in dark mode, the cause is a missing `.dark` token override or hard-coded color — fix per CLAUDE.md §20a Phase 9 token system before declaring done.

- [ ] **Step 13.4: Confirm zero-error verification**

Re-run §5a one more time after the smoke test (anything you fixed during smoke needs to re-verify):
```bash
npx tsc --noEmit && npx vite build
```
Expected: exit 0 on both.

- [ ] **Step 13.5: Commit any smoke-test fixes**

```bash
git status
# if there are untracked or modified files:
git add <those-files>
git commit -m "fix(olympiad): smoke-test cleanups for phase 1"
```

- [ ] **Step 13.6: Confirm Phase 1 acceptance criteria**

Walk through the spec acceptance list ([2026-05-26-olympiad-phase-1-super-admin-catalog-design.md §8](../specs/2026-05-26-olympiad-phase-1-super-admin-catalog-design.md)) and tick each line:

- [ ] Super admin can create + edit a campaign with all fields
- [ ] Super admin can create subjects with class applicability
- [ ] Super admin can create topics per (subject, class)
- [ ] Super admin can author questions one at a time with live KaTeX preview
- [ ] Super admin can bulk upload questions via CSV with row-level validation
- [ ] Super admin can filter, sort, bulk-deactivate questions
- [ ] Super admin can upload study material PDFs
- [ ] Olympiad feature card appears in Edit Institution > Features
- [ ] `/admin/olympiad` route is sidebar-visible to super admin and only to super admin
- [ ] Every new RLS policy uses SECURITY DEFINER helpers, no inline cross-table EXISTS
- [ ] Every new FK has an index in the same migration
- [ ] Every new `useQuery` sets explicit `staleTime`
- [ ] `npx tsc --noEmit`, `npx eslint <changed>`, `npx vite build` all exit 0
- [ ] All pages pass §20b mobile-design checklist (375 px, light + dark)
- [ ] All money displayed as ₹X + 18% GST = ₹Y breakdown
- [ ] No em-dashes in user-facing copy

---

## Self-Review Summary

- **Spec coverage:** every Phase 1 spec requirement maps to one or more tasks: DB schema (T1), feature card (T2), helpers (T3), routing/shell (T4-5), Campaign (T6), Subjects (T7), Topics (T8), Questions + CSV (T9-10), Study Materials (T11), Schools-empty (T12), verification (T13).
- **Placeholders:** no "TBD" / "TODO" / "implement later" — every code block is concrete.
- **Type consistency:** `OlympiadCampaign`, `OlympiadSubject`, `OlympiadTopic`, `BankQuestion`, `StudyMaterial` types are declared once in their hook file and consumed everywhere by name. `QuestionUpsertInput` and `OlympiadTopicInput` shapes match the RPC's `p_payload` schema from the migration.
- **Known risks called out:**
  - `MathPreview` prop shape — verify in T9 before locking in (`text` vs `content`)
  - `EmptyState` import path / prop names — match existing signature in T7, T12
  - `MobileTabs` API shape — T4 includes a fallback rendering pattern
  - `Trophy`/`Award` icons taken — `Medal` chosen instead

If during execution a hook prop or component API turns out to differ from what's written here, fix to match the existing source-of-truth and continue — that's a known consequence of writing the plan from spec rather than re-reading every primitive.
