# SALCI Olympiad Phase 1 — Super Admin Catalog Design

**Status:** Draft v1
**Date:** 2026-05-26
**Parent doc:** [2026-05-26-olympiad-master-decomposition-design.md](./2026-05-26-olympiad-master-decomposition-design.md)
**Source:** SALCI_Olympiad_Build_Prompt2.docx (Phase 1)

This phase delivers the central catalog SALCI super admin uses to set up an Olympiad campaign. **Nothing is student-facing or school-facing yet.** It also lands the `olympiad` feature flag card in the Edit Institution > Features grid (the user-visible toggle the screenshot referenced).

---

## 1. Scope

In:

- DB schema for 7 catalog tables (`oly_campaigns`, `oly_subjects`, `oly_subject_classes`, `oly_topics`, `oly_questions`, `oly_study_materials`, `oly_schools`)
- `olympiad` feature flag entry in `featuresData.ts` and `FEATURE_URL_MAP`
- Storage bucket `olympiad-study-material` with RLS
- `/admin/olympiad` route + sidebar entry
- Campaign settings editor (one row per year)
- Subject catalog editor
- Topic catalog editor (per subject × class)
- Question bank: single-question authoring with live KaTeX preview, CSV bulk upload with row-level validation, table view with filter / sort / bulk activate-deactivate
- Study material PDF upload (per subject × class) with bulk drag-and-drop
- Schools tab with empty list + disabled "Onboard New School" button (the form lives in Phase 2)
- Lock rule implementation (DB trigger) for once-Active-and-enrolled — fully takes effect after Phase 2 ships enrollment, but the trigger lands here

Out (deferred to later phases):

- School onboarding form (Phase 2)
- Public parent payment URL (Phase 2)
- Payment adapter (Phase 2)
- School admin / teacher portals (Phase 3)
- Exam delivery (Phase 4)
- Results pipeline + dormancy (Phase 5)

---

## 2. Database schema

One migration file: `supabase/migrations/<timestamp>_oly_phase_1_catalog.sql`.

### 2.1 `oly_campaigns`

```sql
create table oly_campaigns (
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
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_oly_campaigns_status on oly_campaigns(status);
```

### 2.2 `oly_subjects` and `oly_subject_classes`

```sql
create table oly_subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(name)
);

create table oly_subject_classes (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references grade_levels(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(subject_id, grade_level_id)
);
create index idx_osc_subject on oly_subject_classes(subject_id);
create index idx_osc_grade_level on oly_subject_classes(grade_level_id);
```

Note: Olympiad classes are global grades (Class 3–10), not institution-scoped `classes` rows. They reference the existing `grade_levels` table (which CLAUDE.md §22 notes is global, no `institution_id` column).

### 2.3 `oly_topics`

```sql
create table oly_topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references grade_levels(id) on delete restrict,
  name text not null,
  status text not null default 'active' check (status in ('active','archived')),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subject_id, grade_level_id, name)
);
create index idx_oly_topics_subject_grade on oly_topics(subject_id, grade_level_id);
create index idx_oly_topics_status on oly_topics(status);
```

### 2.4 `oly_questions`

```sql
create table oly_questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references grade_levels(id) on delete restrict,
  topic_id uuid references oly_topics(id) on delete set null,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer char(1) not null check (correct_answer in ('A','B','C','D')),
  internal_notes text,
  status text not null default 'active' check (status in ('active','inactive')),
  image_url text,  -- reserved for v2; unused in v1
  times_used integer not null default 0,
  total_correct integer not null default 0,
  total_attempts integer not null default 0,
  total_time_seconds bigint not null default 0,
  last_used_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_oly_questions_subject_grade on oly_questions(subject_id, grade_level_id);
create index idx_oly_questions_topic on oly_questions(topic_id);
create index idx_oly_questions_status on oly_questions(status);
```

Computed-on-read metrics: `avg_correct_rate = total_correct::float / nullif(total_attempts, 0)`, `avg_time_seconds = total_time_seconds::float / nullif(total_attempts, 0)`. Returned by an RPC `oly_question_bank_view(subject_id, grade_level_id, filters jsonb, sort text, page int, page_size int)` so the client never SELECT-*'s the raw table.

### 2.5 `oly_study_materials`

```sql
create table oly_study_materials (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references grade_levels(id) on delete restrict,
  title text not null,
  description text,
  storage_path text not null,  -- olympiad-study-material/{subject_id}/{grade_level_id}/{filename}
  file_size_bytes integer not null check (file_size_bytes > 0),
  display_order integer not null default 0,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_osm_subject_grade on oly_study_materials(subject_id, grade_level_id);
create index idx_osm_display_order on oly_study_materials(display_order);
```

Storage bucket policy: only authenticated super admin can write. Read access is granted via signed URLs from a SECURITY DEFINER RPC (which gates on Phase-2 enrollment + subject choice — Phase 1 just lays the bucket; only super admin reads.)

### 2.6 `oly_schools`

```sql
create table oly_schools (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references oly_campaigns(id) on delete restrict,
  institution_id uuid not null references institutions(id) on delete cascade,
  school_short_code text not null unique check (school_short_code ~ '^[A-Z0-9]{6}$'),
  city text,
  state text,
  primary_contact_name text not null,
  primary_contact_email text not null,
  primary_contact_phone text not null,
  participating_grade_level_ids uuid[] not null default '{}',
  price_override_paise integer check (price_override_paise > 0),
  is_existing_salci_school boolean not null default false,
  status text not null default 'enrollment_open' check (status in ('enrollment_open','enrollment_closed','batches_scheduled','exam_in_progress','results_published','archived')),
  internal_notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, institution_id)
);
create index idx_oly_schools_campaign on oly_schools(campaign_id);
create index idx_oly_schools_institution on oly_schools(institution_id);
create index idx_oly_schools_status on oly_schools(status);
```

Phase 1 lands this table empty; rows are inserted in Phase 2.

### 2.7 Lock-on-Active trigger

```sql
create or replace function oly_campaign_lock_check()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  has_enrolled_school boolean;
begin
  if (old.status = 'active' and new.status = 'active') then
    select exists(
      select 1 from oly_schools
       where campaign_id = new.id
         and status != 'enrollment_open'  -- any school past Open means enrollments have started
    ) into has_enrolled_school;

    if has_enrolled_school then
      if (new.exam_duration_minutes != old.exam_duration_minutes
       or new.questions_per_subject != old.questions_per_subject
       or new.gst_percent != old.gst_percent
       or new.gold_threshold_percent != old.gold_threshold_percent
       or new.silver_threshold_percent != old.silver_threshold_percent
       or new.bronze_threshold_percent != old.bronze_threshold_percent) then
        raise exception 'cannot edit locked campaign fields once schools have enrolled' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger oly_campaign_lock_before_update
  before update on oly_campaigns
  for each row execute function oly_campaign_lock_check();
```

`default_price_paise` and per-school `oly_schools.price_override_paise` stay editable per docx.

### 2.8 RLS

Pattern: every table has `enable row level security` and policies referencing SECURITY DEFINER helpers, never inline EXISTS.

```sql
alter table oly_campaigns enable row level security;
create policy "super_admin all" on oly_campaigns for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

-- oly_subjects, oly_subject_classes, oly_topics, oly_questions, oly_study_materials:
-- super_admin full access; school admins/teachers/students get scoped reads added in later phases.
-- Phase 1 only writes the super_admin policy on each.

alter table oly_schools enable row level security;
create policy "super_admin all" on oly_schools for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));
-- school-admin / teacher read policies land in Phase 2-3.
```

`is_super_admin(uuid)` is an existing helper — verify in the implementation plan; if missing, add it as `select exists(select 1 from user_roles where user_id = $1 and role = 'super_admin')`.

---

## 3. Feature flag card

Two edits to [src/components/admin/institution-wizard/featuresData.ts](../../../src/components/admin/institution-wizard/featuresData.ts):

```ts
// In AVAILABLE_FEATURES, under "Advanced Features":
{ id: "olympiad", name: "SALCI Olympiad", description: "Run the SALCI Olympiad campaign for this school", icon: Trophy, category: "advanced", isDefault: false },

// In FEATURE_URL_MAP:
"/school/olympiad": "olympiad",
"/teacher/olympiad": "olympiad",
"/student/olympiad": "olympiad",
```

Import `Trophy` from `lucide-react` at the top of the file. No changes needed to `FeaturesSelectionStep` or `EditInstitutionDialog` — they read `AVAILABLE_FEATURES` and auto-render.

`/admin/olympiad` is intentionally NOT in `FEATURE_URL_MAP` — super admin sees that route regardless of any institution's flag state.

When the toggle is saved via `EditInstitutionDialog`'s `saveFeatures` mutation, a row `{ institution_id, feature_id: 'olympiad', is_enabled: true }` is inserted into `institution_features`. Existing mutation handles this without modification.

---

## 4. Routing and sidebar

### 4.1 Routes (Phase 1)

```
/admin/olympiad                              → OlympiadAdminPage (Campaign tab default)
/admin/olympiad/subjects                     → OlympiadAdminPage (Subjects tab)
/admin/olympiad/subjects/:subjectId          → OlympiadSubjectDetailPage (Topics tab default)
/admin/olympiad/subjects/:subjectId/questions → OlympiadSubjectDetailPage (Questions tab)
/admin/olympiad/subjects/:subjectId/study-material → OlympiadSubjectDetailPage (Study Material tab)
/admin/olympiad/schools                      → OlympiadAdminPage (Schools tab)
```

Lazy-loaded per CLAUDE.md §23.3. New routes added to [src/App.tsx](../../../src/App.tsx) under the super-admin protected block.

### 4.2 Sidebar entry

In [src/components/layout/AppSidebar.tsx](../../../src/components/layout/AppSidebar.tsx), add `{ url: "/admin/olympiad", label: "Olympiad", icon: Trophy }` to the super_admin nav list. Visibility is gated by the existing super-admin role check, not by `FEATURE_URL_MAP`.

---

## 5. Page composition (per CLAUDE.md §20a/§20b)

### 5.1 `OlympiadAdminPage` — `/admin/olympiad`

```tsx
<PageShell>
  <PageHeader
    eyebrow="Super Admin"
    title="SALCI Olympiad"
    subtitle="Campaign settings, subjects, and participating schools"
  />
  <MobileTabs
    tabs={[
      { value: "campaign", label: "Campaign", to: "/admin/olympiad" },
      { value: "subjects", label: "Subjects", to: "/admin/olympiad/subjects" },
      { value: "schools",  label: "Schools",  to: "/admin/olympiad/schools" },
    ]}
  />
  <Outlet />
</PageShell>
```

### 5.2 Campaign tab

Lives at `/admin/olympiad`. Phase 1 supports a single active campaign at a time. Page logic:

- If no `oly_campaigns` row exists for the current calendar year, show a creation form pre-filled with sensible defaults (price ₹500, GST 18%, exam duration 90 min, etc.)
- If a row exists for the current year, show it as an editable form
- A small history strip at the bottom shows closed campaigns from prior years, read-only (drill into each to view its locked settings)

Fields per §2.1 with helper text, `formatOlympiadFee` preview for the price + GST breakdown, and a status pill (Draft / Active / Closed) with a "Set Active" button.

Lock UX: once locked fields can't be changed, show them as read-only with a Lock icon and tooltip "Locked — schools have enrolled. Edit campaign settings only by closing this campaign and creating a new one."

`StatTileGrid` above the form: Total Subjects, Total Topics, Total Questions in Bank, Total Study Materials. These are cheap server-side counts via a single RPC.

### 5.3 Subjects tab

`/admin/olympiad/subjects`. `FilterRow` (Active / Archived chip), `ListRow` per subject showing name, applicable classes (badges), counts of (topics, questions, study materials), trailing chevron. Tap → `/admin/olympiad/subjects/:id`. "+ New Subject" button in `PageHeader.primaryAction` opens a `MobileSheet`.

### 5.4 Subject detail page — `OlympiadSubjectDetailPage`

Internal `MobileTabs`: Topics / Questions / Study Material.

**Topics sub-tab.** Per-class accordion (Class 3 → Class 10, only showing classes the subject applies to). Inside each class section: `ListRow` per topic (name, display_order, status). Edit topic via `MobileSheet`. Bulk archive via `FilterRow` chip + selection.

**Questions sub-tab.** Class selector at the top (chips). Below: `FilterRow` (Topic, Status) + Sort chip (Avg Correct Rate ↑, Times Used ↓, Last Used ↓). Question list as `ListRow` with KaTeX-rendered preview of question text (truncated). Pagination via `range()` per CLAUDE.md §23.1; never `select("*")`. Two primary actions in `PageHeader.secondaryActions` (kebab): "+ Add Question" → `MobileSheet` form, "Bulk CSV Import" → dedicated `MobileSheet`.

**Single-question authoring form.** Live KaTeX preview via `MathPreview` per CLAUDE.md §8. Fields per §2.4. On save, INSERT or UPDATE via `oly_questions_upsert(...)` RPC (returns the inserted row).

**CSV import form.** Step 1: download template button (statically generated, no server call). Step 2: drag-and-drop or pick a `.csv` file. Client-side PapaParse → preview table with row-level validation errors highlighted (unknown topic, missing required column, invalid correct_answer value, KaTeX brace imbalance). Step 3: "Import N valid rows" button. Invalid rows are listed but not imported. Imports go through an edge function `oly-question-csv-import` that does the bulk INSERT inside a transaction.

**Study Material sub-tab.** Per-class accordion (same structure as Topics). Each material row: title, file size, display order, download / replace / delete actions. "+ Add Material" → `MobileSheet` with file picker (10 MB cap, PDF only), title, description, order. Bulk drag-and-drop opens a `MobileSheet` with a batch table to assign title + order before final upload.

### 5.5 Schools tab

`/admin/olympiad/schools`. `EmptyState` with a Trophy icon, copy "No schools onboarded yet. Use Onboard New School to add the first one.", and a disabled "Onboard New School" button (tooltip: "Onboarding form ships in Phase 2"). Phase 1 ships only the empty state.

---

## 6. Hooks and RPCs

New hooks in `src/hooks/olympiad/`:

- `useOlympiadCampaign()` — fetch + upsert active campaign (single-row). `staleTime: 60_000`.
- `useOlympiadSubjects(filters?)` — paginated list. `staleTime: 30_000`.
- `useOlympiadSubject(subjectId)` — single subject with class applicability.
- `useOlympiadTopics(subjectId, gradeLevelId)` — paginated list.
- `useOlympiadQuestionBank(subjectId, gradeLevelId, filters, sort, page, pageSize)` — calls `oly_question_bank_view` RPC. `staleTime: 30_000`.
- `useOlympiadStudyMaterials(subjectId, gradeLevelId)` — list + signed-URL helper for super admin downloads.
- `useUpsertOlympiadQuestion()`, `useUpsertOlympiadTopic()`, `useUpsertOlympiadSubject()`, `useUploadOlympiadStudyMaterial()` — mutations, each routing `onError` through `toastError`.

RPCs in the migration:

- `oly_question_bank_view(subject_id, grade_level_id, filters jsonb, sort text, page int, page_size int)` returns paginated rows + total count.
- `oly_questions_upsert(payload jsonb)` returns the inserted/updated row.
- `oly_campaign_stats()` returns counts for the StatTileGrid.

Edge functions in `supabase/functions/`:

- `oly-question-csv-import` — accepts the parsed rows + campaign_id, returns `{ inserted_count, errors }`.

---

## 7. Reuse and helpers

- `MathPreview` (existing) for KaTeX live preview during authoring per CLAUDE.md §8
- `PageShell` / `PageHeader` / `MobileTabs` / `FilterRow` / `FilterSheet` / `MobileSheet` / `StatTile` / `ListRow` / `EmptyState` per CLAUDE.md §20a/§20b
- `toastError` per CLAUDE.md §19
- `formatOlympiadFee` (new, lives in `src/lib/olympiad/money.ts`) — per master spec §9
- `invokeAdminOperation`-style wrapper for edge function calls per CLAUDE.md §21
- PapaParse — already a dependency (verify in implementation plan); if not, add it

---

## 8. Acceptance criteria

Each must pass before Phase 1 is called done. Mirrors the docx Phase 1 acceptance list, tightened with project conventions.

- Super admin can create + edit a campaign with all fields; lock rule blocks edits to locked fields once Phase 2 enrollment exists (verify via a manual test once Phase 2 lands)
- Super admin can create subjects with class applicability
- Super admin can create topics per (subject, class)
- Super admin can author questions one at a time with live KaTeX preview
- Super admin can bulk upload questions via CSV with row-level validation; valid rows imported, invalid rows reported
- Super admin can filter, sort, bulk-deactivate questions in the bank
- Super admin can upload study material PDFs per (subject, class)
- The Olympiad feature card appears in Edit Institution > Features and saving with it ticked writes a row to `institution_features`
- `/admin/olympiad` is sidebar-visible to super admin and only to super admin
- Every new RLS policy uses SECURITY DEFINER helpers, no inline cross-table EXISTS
- Every new FK has an index in the same migration (CLAUDE.md §23.1)
- Every new `useQuery` sets explicit `staleTime` (CLAUDE.md §23.2)
- All touched files pass §5a zero-error contract: `npx tsc --noEmit`, `npx eslint <changed>`, `npx vite build` exit 0
- All pages pass §20b mobile-design checklist (375 px, light + dark mode)
- All money displayed as `₹X + 18% GST = ₹Y` breakdown (master spec §9)
- No em-dashes in user-facing copy

---

## 9. Risks and open items

- **`is_super_admin(uuid)` helper.** Assumed to exist. If not, add in this migration. Verify during implementation plan.
- **PapaParse dependency.** Assumed to exist. Verify; if not, add it.
- **Campaign multi-year UX.** Phase 1 ships single-active-campaign UX. If product wants to view past campaigns in Phase 1, raise during plan review.
- **Question metrics live-aggregation cost.** Computing avg_correct_rate from the bank-view RPC over thousands of questions may be slow; if so, promote to a materialized view in Phase 5 once attempts data exists.
- **Sidebar Trophy icon collision.** `Trophy` is used elsewhere in the codebase (verify in plan). If collision, pick a distinct icon (e.g. `Award` or `Medal`).
- **Phase 1 Schools tab disabled button.** Confirm during plan whether to ship the button at all in Phase 1, or hide entirely until Phase 2.
