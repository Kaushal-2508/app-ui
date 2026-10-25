# Timetable + Academic Calendar — Full Rebuild

**Date:** 2026-04-23
**Status:** Design (awaiting implementation plan)
**Scope:** `tt:iii` per Q1/Q2 — full rewrite of the Timetable and Academic Calendar modules (DB schema, RLS, edge functions, frontend), with cascade into `/teacher/my-week` and `/student/my-week`. External consumers preserved via a compatibility shim layer.

---

## 1. Why we're rebuilding

The current implementation suffers from three categorized problems:

1. **UX/workflow confusion.** The 3-step "Period Structures → Class Assignments → Build" funnel forces admins and coordinators through a tab order they don't think in. The page leads with setup tabs instead of the work itself (filling cells).
2. **Missing features.** No draft/publish state, no substitution handling, no notification flow when a teacher is absent, no per-class status visibility on the home view, no multi-class period-structure assignment in one shot.
3. **Mobile-unfriendly.** The current grid + tabs + side panels assume a wide screen; coordinators cannot run setup or fills from a phone.

The rebuild solves all three while preserving every external API the rest of the app depends on.

---

## 2. Roles & responsibilities

| Role | Period Structures | Class ↔ Structure mapping | Calendar | Fill cells (subject + teacher) | Publish | View teachers' filled timetable | Lesson plans |
|---|---|---|---|---|---|---|---|
| **Admin (school_admin / super_school_admin / super_admin)** | Create/edit | Create/edit | Create/edit | Full power, override anywhere | Yes | All teachers | View all |
| **Coordinator** | Read-only | Read-only | Read-only | Their wing only | Their wing only | Their wing | View only (their wing) |
| **Teacher** | Read-only | — | Read-only | — | — | Only their own slots | Create + edit their own |
| **Student** | — | — | Read-only | — | — | Only published slots in their class | Read-only (planned/done only) |

**Workflow chain:**
1. Admin creates one or more period structures (weekly grid: periods, breaks, working days).
2. Admin assigns each structure to one or many classes (multi-select supported in one operation).
3. Admin sets up the academic calendar (AY boundaries, holidays, exam blocks, events).
4. Coordinator opens their wing's class list, picks a class, fills cells (subject + teacher per period × day), publishes when ready.
5. Teachers see their personal week (only their own slots) and create lesson plans per date.
6. Students see their class's published timetable + planned/done lesson topics.

---

## 3. Data model

All new tables prefixed `tt_` (timetable) or `cal_` (calendar) so they coexist with the legacy schema during migration.

### 3.1 Timetable tables

#### `tt_period_structures`
Weekly grid template owned by the institution.
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE`
- `name TEXT NOT NULL`
- `working_days TEXT[] NOT NULL CHECK (working_days <@ ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])`
- `created_at, updated_at TIMESTAMPTZ DEFAULT now()`
- `created_by UUID REFERENCES profiles(id) ON DELETE SET NULL` (per CLAUDE.md §21)

#### `tt_period_slots`
Periods + breaks within a structure.
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `structure_id UUID NOT NULL REFERENCES tt_period_structures(id) ON DELETE CASCADE`
- `period_number INTEGER NOT NULL` (1..N for periods, 1000+idx for breaks — per timetable-module skill §1)
- `label TEXT NOT NULL`
- `start_time TIME NOT NULL`
- `end_time TIME NOT NULL CHECK (end_time > start_time)`
- `kind TEXT NOT NULL CHECK (kind IN ('period','break'))`
- `UNIQUE (structure_id, period_number)`
- Trigger `prevent_overlapping_period_slots` using `tsrange` with exclusive `()` bounds so back-to-back slots do not falsely conflict (matches current behavior).

#### `tt_class_structure`
Many-to-many: which classes use which structure for an academic year. **Also holds the per-class publish state** (single status governs the whole class's timetable for that AY — matches Q5/cross-cutting (1) "per-class draft").
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE`
- `structure_id UUID NOT NULL REFERENCES tt_period_structures(id) ON DELETE RESTRICT`
- `academic_year TEXT NOT NULL`
- `institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE`
- `publish_status TEXT NOT NULL DEFAULT 'draft' CHECK (publish_status IN ('draft','published'))`
- `published_at TIMESTAMPTZ`
- `published_by UUID REFERENCES profiles(id) ON DELETE SET NULL`
- `UNIQUE (class_id, academic_year)` — one structure per class per AY
- Index on `(structure_id)` to surface "which classes use this structure?" for the delete-blocked error message.

**Visibility rule (enforced via RLS on `tt_slots` and `tt_lesson_plans`):**
- Teachers see only slots whose parent class has `publish_status = 'published'`.
- Students see only slots whose parent class has `publish_status = 'published'`.
- Admin and coordinator see all slots (draft and published) for in-scope classes.
- Edits to a published class go live immediately (no separate re-publish step) — Q5 option A.

#### `tt_resources`
School-wide pool of bookable resources (lab, library, computer room, etc.).
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE`
- `name TEXT NOT NULL`
- `kind TEXT NOT NULL CHECK (kind IN ('lab','library','computer_room','sports_facility','other'))`
- `capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1)`
- `description TEXT`
- `UNIQUE (institution_id, name)`

#### `tt_slots`
The cells (recurring template per academic year). One row per (class, day, period, year).
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE`
- `class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE`
- `period_slot_id UUID NOT NULL REFERENCES tt_period_slots(id) ON DELETE CASCADE`
- `day TEXT NOT NULL CHECK (day IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday'))`
- `academic_year TEXT NOT NULL`
- `slot_type TEXT NOT NULL CHECK (slot_type IN ('theory','practical','library','sports','arts','assembly','free','break'))`
- `subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL`
- `teacher_id UUID REFERENCES profiles(id) ON DELETE SET NULL`
- `resource_id UUID REFERENCES tt_resources(id) ON DELETE SET NULL`
- `notes TEXT`
- `created_at, updated_at TIMESTAMPTZ DEFAULT now()`
- `UNIQUE (class_id, period_slot_id, day, academic_year)` — one assignment per cell per year
- **Publish state lives on `tt_class_structure`** (per-class), not per slot. A slot's effective visibility = parent class's `publish_status`.
- CHECK constraint: when `slot_type IN ('theory','practical')`, `subject_id` and `teacher_id` are required (enforced via partial CHECK or trigger so non-academic slots can stay nullable)
- **No DB-side conflict check.** Pure conflict engine in `src/lib/timetableConflicts.ts` (port of current `timetableConflicts.ts`) is authoritative. Schools sometimes legitimately need to override; a hard DB rule blocks edits.

#### `tt_substitutions`
One-off date overrides for an absent teacher.
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `slot_id UUID NOT NULL REFERENCES tt_slots(id) ON DELETE CASCADE`
- `date DATE NOT NULL`
- `substitute_teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`
- `reason TEXT`
- `created_by UUID REFERENCES profiles(id) ON DELETE SET NULL`
- `created_at TIMESTAMPTZ DEFAULT now()`
- `UNIQUE (slot_id, date)` — one substitute per date

#### `tt_lesson_plans`
Per-date instance of a slot. Owned by the original teacher (not the substitute). Denormalizes `class_id`, `subject_id`, `owner_teacher_id`, `session_type` from the parent `tt_slots` row for fast indexed queries (matches current `lesson_plans` pattern that `useSyllabusCoverage` and other hooks depend on).
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE`
- `slot_id UUID NOT NULL REFERENCES tt_slots(id) ON DELETE CASCADE`
- `class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE` (denormalized)
- `subject_id UUID REFERENCES universal_subjects(id) ON DELETE SET NULL` (denormalized)
- `owner_teacher_id UUID REFERENCES profiles(id) ON DELETE CASCADE` (denormalized; original teacher of the slot, not substitute)
- `date DATE NOT NULL`
- `session_type TEXT NOT NULL CHECK (session_type IN ('teaching','test','doubt_session','other'))` (preserves current semantics; coverage math filters by `session_type='teaching'`)
- `status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','pending','skipped'))`
- `topic_id UUID REFERENCES syllabus_topics(id) ON DELETE SET NULL`
- `chapter_topic_id UUID REFERENCES chapter_topics(id) ON DELETE SET NULL`
- `addressed_topic_ids UUID[] DEFAULT '{}'`
- `note TEXT`
- `planned_at TIMESTAMPTZ` (auto-stamped by trigger on first transition to `planned`)
- `done_at TIMESTAMPTZ` (auto-stamped by trigger on first transition to `done`)
- `updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL`
- `created_by UUID REFERENCES profiles(id) ON DELETE SET NULL`
- `created_at, updated_at TIMESTAMPTZ DEFAULT now()`
- `UNIQUE (slot_id, date)` — one plan per date, upsert key (matches current pattern)
- Trigger `tt_lesson_plans_stamp_status` mirrors current `lesson_plans_stamp_status`: sets `planned_at = now()` on first `planned`, `done_at = now()` on first `done`, never clobbers existing timestamps.

**Status `pending` is new** (current schema only has `planned/done/skipped`). Set automatically by the `tt-notify-absence-pending` cron when a substituted slot's plan was never resolved by the original teacher. Treated as "pending teacher action" — UI shows it in the inbox.

### 3.2 Calendar tables

#### `cal_academic_years`
Replaces ad-hoc string-typed `academic_year` columns scattered across the app.
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE`
- `code TEXT NOT NULL` (e.g., `'2026-27'`)
- `starts_on DATE NOT NULL`
- `ends_on DATE NOT NULL CHECK (ends_on > starts_on)`
- `is_active BOOLEAN NOT NULL DEFAULT false`
- `UNIQUE (institution_id, code)`
- Partial unique index: `CREATE UNIQUE INDEX one_active_year_per_institution ON cal_academic_years (institution_id) WHERE is_active`
- Note: `code` remains the canonical identifier used by external code (`currentAcademicYear()` returns this string).

#### `cal_events`
Holidays, exam blocks, and informational events. Replaces the current `academic_calendar` table. Terms intentionally excluded per user decision ("remove the term system"). PTM and special events from the legacy enum collapse into the generic `event` kind.
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE`
- `academic_year TEXT NOT NULL` (denormalized for fast filtering)
- `title TEXT NOT NULL`
- `kind TEXT NOT NULL CHECK (kind IN ('holiday','exam_block','event'))`
- `starts_on DATE NOT NULL`
- `ends_on DATE NOT NULL CHECK (ends_on >= starts_on)` (single-day events have `ends_on = starts_on`)
- `color TEXT` (optional override)
- `notes TEXT`
- `created_by UUID REFERENCES profiles(id) ON DELETE SET NULL`
- `created_at, updated_at TIMESTAMPTZ DEFAULT now()`
- Trigger `prevent_overlapping_exam_blocks` (port from current `academic_calendar` migration) — only blocks `exam_block` ↔ `exam_block` overlaps; holidays vs exam_blocks remain a soft confirm at the UI layer.

**Legacy enum mapping (used by Phase 2 backfill):**
| Old `academic_calendar.event_type` | New `cal_events.kind` |
|---|---|
| `holiday` | `holiday` |
| `exam_block` | `exam_block` |
| `ptm` | `event` |
| `special_event` | `event` |
| `working_day` | (skipped — was already computed client-side per the original design comment) |
| `term_start` | (skipped — terms removed) |
| `term_end` | (skipped — terms removed) |

### 3.3 Edge functions

| Function | Purpose | Replaces |
|---|---|---|
| `tt-rollover-year` | Copies `tt_slots` from source AY to target AY (skips `tt_lesson_plans`). Returns `{copied, skipped}`. | `copy-timetable-template` |
| `tt-notify-substitute` | Fires when a `tt_substitutions` row is inserted: in-app notification to substitute teacher with slot info, in-app notification to original teacher with "you were marked absent." | New |
| `tt-notify-absence-pending` | Nightly cron at 23:00 institution local time. For any `tt_lesson_plans.status='planned'` whose slot was substituted on or before today, flips to `pending` and re-notifies the original teacher with one-click resolve actions. | New |

Deploy command per CLAUDE.md §8 pattern: `npx supabase@latest functions deploy <name> --project-ref gyymkgohcijeksmrzuyw`.

### 3.4 Key invariants (DB-enforced)

- `prevent_overlapping_period_slots` trigger on `tt_period_slots` (preserves current behavior).
- `UNIQUE (class_id, period_slot_id, day, academic_year)` on `tt_slots`.
- `UNIQUE (slot_id, date)` on `tt_lesson_plans` and `tt_substitutions`.
- Partial unique index on `cal_academic_years` for `is_active = true`.
- All FKs to `profiles(id)` follow CLAUDE.md §21 cascade rules: `CASCADE` for ownership (`teacher_id`, `owner_teacher_id`, `substitute_teacher_id`), `SET NULL` for authorship (`created_by`, `published_by`, `updated_by`).

### 3.5 RLS pattern

Mirrors existing project conventions (timetable-module skill §3):
- All tables: `institution_id` scoping via `public.get_user_institution(auth.uid())`.
- `tt_period_structures`, `tt_resources`, `cal_*`: write gated on `school_admin` or `super_school_admin`. Super admins `FOR ALL`. Coordinators read-only.
- `tt_class_structure`: write gated on admin (per user spec — coordinator does not assign structures to classes; admin owns this).
- `tt_slots`: admin full write; coordinator write only for classes whose `wing_id` matches their `wing_assignments` (pattern from `wing_class_mappings × wing_assignments`); teacher no write.
- `tt_substitutions`: admin + coordinator (wing-scoped) write.
- `tt_lesson_plans`: admin full write; coordinator wing-scoped write; teacher write only where `tt_slots.teacher_id = auth.uid()`. Student read where `tt_slots.class_id` matches their enrollment AND `status IN ('planned','done')`. `note` column projected away from student-facing queries (per timetable-module skill §4).

---

## 4. Page architecture & UX

### 4.1 Routes

| Route | Owner | Notes |
|---|---|---|
| `/school/timetable` | Admin + Coordinator | Class list home → workspace per class. Gear icon (admin) opens setup sheet. |
| `/school/calendar` | Admin write, all read | Month/agenda view, AY selector, color-coded entries. |
| `/teacher/my-week` | Teacher | Mobile-first weekly grid + lesson plan inbox. |
| `/student/my-week` | Student | Read-only weekly grid + "What's coming" strip. |
| `/school/period-structures` | (redirect) | `<Navigate>` to `/school/timetable?gear=structures` for back-compat with bookmarks/sidebar. |
| `/school/shared-resources` | Admin | Standalone Resources page (matches current pattern; also accessible from gear sheet). |

### 4.2 Timetable home view

- **Header bar:** AY selector (left), search + filter (center), gear icon (admin only, right).
- **Class list:** responsive grid of cards (1 col mobile, 2 col tablet, 3 col desktop).
- **Each card shows:**
  - Class name + section (e.g., "10 - A")
  - Status pill derived from `tt_class_structure.publish_status`: `Empty` (grey, no structure assigned OR no `tt_slots` rows yet), `Draft` (amber, `publish_status='draft'` AND ≥1 slot exists), `Published` (green, `publish_status='published'`)
  - Filled-cell ratio: `<count of tt_slots rows for class+AY> / <working_days × non-break period_slots>`
  - Last edited: "2 hours ago by Priya M." (or "Never") — derived from `MAX(updated_at)` across the class's `tt_slots`
- **Filter chips:** All · Empty · Draft · Published, plus wing filter for admins.
- **Empty state (no classes in scope):** reuses current diagnostic logic in `useTimetableScopeDiagnostic` (no classes for AY / no classes in wing / coordinator unassigned).

### 4.3 Class workspace (when a card is clicked)

- **Layout:** `lg:grid-cols-[1fr_320px]` two-pane on desktop; single column on mobile with bottom-sheet teacher load.
- **Header bar:** Back button → class list, class name + structure name, **Save Draft** + **Publish** (Publish disabled if any required cell is empty), **Print** button, **Substitute mode** toggle.
- **Left:** the timetable grid. Each cell shows: subject (top, bold), teacher initials (middle), colored band by subject (left edge). Tap → opens slot drawer.
- **Right (desktop) / bottom sheet (mobile):** Teacher Load panel. Lists all teachers in scope with their weekly hour count (`hours / capacity`). Click a teacher → highlights their cells in the grid green.
- **Below the grid:** Class week digest (per-date overview, opens lesson plan panel on click — matches current `ClassWeekDigest` pattern but reads from `tt_lesson_plans`).

### 4.4 Slot drawer (slide-up sheet on mobile, side sheet on desktop)

- **Header:** "Monday · Period 1 (08:00 – 08:30) · Class 10 - A"
- **Body fields, in order:**
  1. **Slot type** — segmented control (Theory / Practical / Library / Sports / Arts / Assembly / Free / Break)
  2. **Subject** — shown only for Theory/Practical. Dropdown of subjects mapped to this class.
  3. **Teacher** — dropdown of teachers who teach the selected subject for this class. Each teacher shows a live "Busy / Free" badge based on cross-class conflict check (calls `checkTeacherConflict` from `timetableConflicts.ts`). Disabled until subject selected.
  4. **Resource** — optional, shown only for Practical / Library / Sports. Dropdown of resources whose `capacity` allows booking at that period+day (uses `resourceAvailability.ts` pool semantics).
  5. **Notes** — optional free-text.
- **Footer:** **Save** (writes the cell; visibility to teachers/students follows the parent class's `publish_status` on `tt_class_structure`), **Delete** (clears cell), **Cancel**.
- **Substitute mode active:** primary action becomes "Mark substitute for [date picker] → [teacher picker]" instead of editing the recurring cell. Writes to `tt_substitutions`.
- **Form must set `data-dirty="true"`** while editing (per CLAUDE.md §17 SW dirty-form contract).
- **Sticky mobile action bar:** `sticky bottom-0 bg-background border-t -mx-6 px-6 py-3 md:static md:border-0 md:py-0 md:mx-0 md:px-0` (preserves the DialogContent inner-padding compensation pattern from ui-invariants skill §13).

### 4.5 Gear sheet (admin only)

Triggered from top-right gear icon on the timetable home view. Slide-over sheet with three sections:
1. **Period Structures** — list with create/edit/delete; each entry shows usage count ("Used by 6 classes"). Delete blocked with toast "Unassign this structure from all classes before deleting." (matches current behavior).
2. **Shared Resources** — list with create/edit/delete (kind, capacity, description).
3. **Calendar** — short summary card with a button "Open Academic Calendar →" that navigates to `/school/calendar`.

### 4.6 Period structure dialog (within gear sheet)

- Same period-number encoding as today: non-break slots numbered 1..N by `start_time`, break slots numbered 1000+idx (preserves `UNIQUE (structure_id, period_number)` invariant).
- Update strategy: delete-all-then-reinsert (do not diff — diffing collides with renumbering under the trigger).
- New: **multi-class assignment shortcut.** When creating/editing a structure, an inline "Apply to classes" multi-select lets the admin assign the structure to many classes at once (bulk-inserts into `tt_class_structure` for the active AY).

### 4.7 Substitution workflow

1. Coordinator/admin opens a class workspace, toggles **Substitute mode** in the header.
2. Cells now respond to tap with a date-then-teacher picker:
   - Date picker — defaults to next occurrence of that day-of-week, can pick any future date.
   - Teacher picker — filtered to teachers free at that period on that date (cross-checks `tt_slots` recurring schedule and existing `tt_substitutions` rows for that date, excluding any prior substitution on the same `(slot_id, date)` being replaced).
3. On save → INSERT into `tt_substitutions` (or UPDATE if `(slot_id, date)` already exists).
4. `tt-notify-substitute` edge function fires:
   - In-app notification to substitute teacher: "You're covering Class 10-A Period 1 on [date]."
   - In-app notification to original teacher: "You're marked absent for [date]."
5. Original teacher's lesson plan for that date is **not modified** by the substitute. It stays in `planned` status.
6. Nightly cron `tt-notify-absence-pending` (23:00 local) finds any substituted slot whose lesson plan is still `planned` after the substituted date has passed → flips status to `pending` → notifies original teacher: "Your topic on [date] is still pending. Mark Done / Reschedule / Substitute covered it."
7. Original teacher resolves manually from the Lesson Plan inbox in `/teacher/my-week`.

### 4.8 Teacher view (`/teacher/my-week`)

- **Mobile-first** weekly grid showing only the teacher's own cells (filtered: `tt_slots.teacher_id = auth.uid()` UNION `tt_substitutions.substitute_teacher_id = auth.uid()` for the current week).
- Substitute slots show with a **purple "Substitute" badge** + the original teacher's name.
- Tap any cell with a date → opens the **Lesson Plan panel** (status: Planned / Done / Pending / Skipped, topic picker, chapter-topic picker, notes, addressed-topics multi-select, draft autosave per `lessonPlanDraft.ts` 24h localStorage pattern).
- **Pending notifications inbox** at top of page: small alert strip "2 lessons pending your review" → opens a sheet listing each absent-day slot with one-click resolve buttons (Done / Reschedule / Substitute covered it).
- **Topic carry-forward:** when marking `done`, surface top 2 pending teaching topics (computed from `useSyllabusCoverage`, not stored) — preserves current pattern.

### 4.9 Student view (`/student/my-week`)

- Mobile-first weekly grid for the student's class. Shows only `status='published'` slots (drafts invisible).
- Substitutions visible (so students know who to expect).
- Read-only Lesson Plan panel: shows planned topic + status (Planned, Done — never `skipped` or `pending`, never `note`).
- "What's coming" strip at top showing next 3 calendar days' planned rows (max 6, sorted by date+period_start).

### 4.10 Academic Calendar page (`/school/calendar`)

- **Admin view header:** AY selector, "+ Add" button (sheet to add holiday / exam block / event).
- **Main:** month-view calendar (default) with a toggle to year-view (for year-at-a-glance).
- **Color coding:** red (holiday), amber (exam block), blue (event). No "off-day" grey here — Sundays / weekly off-days are a property of each class's period structure (per Q3.iii multiple structures may differ), so showing them on a school-wide calendar would be misleading. The Timetable page shows them per-class instead.
- Click any entry → edit sheet with delete option.
- **Side panel:** chronological list of upcoming entries.
- **Coordinator/teacher/student view:** same UI, no add/edit affordances.
- **Mobile:** month view degrades gracefully to an agenda list (chronological list of next 30 days' entries with date headers).
- **AY rollover:** when admin switches to a year where BOTH `cal_events count = 0` AND `tt_slots count = 0`, auto-open a "New year setup" dialog (matches current `NewYearSetupDialog` pattern). Gated by `sessionStorage` key `ay-setup-prompted:{year}` to fire once per session per year.

### 4.11 Mobile considerations (375px) — applies everywhere

- Class list: single column, full-width cards.
- Class workspace: grid horizontally scrollable (sticky day column on left, sticky period header on top); teacher load collapses into a bottom sheet triggered by a button.
- Slot drawer: bottom sheet, full keyboard-aware, sticky save bar (compensation pattern noted in §4.4).
- Calendar: month view on mobile gracefully degrades to agenda list.
- All forms must set `data-dirty="true"` while editing (CLAUDE.md §17).

---

## 5. Migration & compatibility

The strategy is **parallel-build, atomic-cutover, then drop old**, in six phases.

### 5.1 Phase 1 — New tables alongside old

Single migration creating all `tt_*` and `cal_*` tables with full RLS, triggers, and indexes. Old tables (`period_structures`, `period_slots`, `class_period_structure`, `shared_resources`, `timetable_slots`, `lesson_plans`, `events`) stay untouched. No data copied. No code changes. No user-visible effect.

### 5.2 Phase 2 — One-shot data backfill

Separate migration containing a SQL function `tt_backfill_from_legacy()` (idempotent via `ON CONFLICT DO NOTHING`):
- `period_structures` → `tt_period_structures` (preserves IDs)
- `period_slots` → `tt_period_slots` (preserves IDs and period_number encoding)
- `class_period_structure` → `tt_class_structure`, with `academic_year = currentAcademicYear()` synthesized since the old table didn't track it (admin can edit per-AY mappings post-migration if needed)
- `shared_resources` → `tt_resources`
- `timetable_slots` → `tt_slots` (all rows get `status='published'` since old system had no draft state)
- `lesson_plans` → `tt_lesson_plans` (preserves status, `class_id`, `subject_id`, `session_type`, `topic_id`, `addressed_topic_ids`, `note`, `planned_at`, `done_at`; sets `owner_teacher_id` from `lesson_plans.teacher_id`)
- Distinct `academic_calendar.academic_year` values → `cal_academic_years` rows (synthesized; admin can edit `starts_on/ends_on` post-migration; defaults `starts_on = parse(year, 'YYYY')-04-01`, `ends_on = parse(year+1, 'YYYY')-03-31`)
- `academic_calendar` → `cal_events` (mapping per the table in §3.2: `holiday→holiday`, `exam_block→exam_block`, `ptm/special_event→event`, `working_day/term_*` skipped)
- Wrapped in a single transaction. Logs all skipped rows for manual review.

### 5.3 Phase 3 — Compatibility shim layer (TypeScript, no migration)

New file `src/lib/timetableCompat.ts` exporting:
- `currentAcademicYear(): string` — same signature, reads from `cal_academic_years.code WHERE is_active`. Falls back to old hardcoded month-based logic if no active year exists.
- `useSyllabusCoverage(classId, subjectId)` — same signature and return shape, reads from `tt_lesson_plans`.
- Re-exports of any other public hook/util that external code imports from the old timetable module.

Update existing `src/hooks/useAcademicCalendar.ts` and `src/lib/syllabusCoverage.ts` to internally route through the shim. **External callers' import paths and return shapes do not change.** This is the "no other tabs affected" guarantee.

### 5.4 Phase 4 — Build new UI on new tables

- New pages and components written from scratch under temporary paths:
  - `src/components/timetable-v2/`
  - `src/pages/school/timetable-v2/`
  - `src/pages/school/calendar-v2/`
  - `src/pages/teacher/my-week-v2/`
  - `src/pages/student/my-week-v2/`
- New routes mounted at `/school/timetable-v2`, `/teacher/my-week-v2`, `/student/my-week-v2`, `/school/calendar-v2` so the old and new can coexist for QA.
- All new code uses new tables exclusively. No mixing.

### 5.5 Phase 5 — Atomic cutover

Single PR/commit:
- Rename routes: `/school/timetable-v2` → `/school/timetable` (old timetable code deleted in same commit)
- Move folders: `src/components/timetable-v2/` → `src/components/timetable/` (old folder deleted same commit)
- Same for `pages/school/timetable*`, `pages/school/calendar*`, `pages/teacher/my-week*`, `pages/student/my-week*`.
- Update `AppSidebar`, `FEATURE_URL_MAP`, `RoleBasedDashboard` tile pointers to new routes (these are the only "other-tab-adjacent" files we touch — they are sidebar entries, not tabs).
- Old edge function `copy-timetable-template` deleted; new `tt-rollover-year` deployed.
- `useCopyTimetableYear` removed; new `useTtRolloverYear` introduced (caller is the new TimetablePage).

### 5.6 Phase 6 — Drop old tables

Separate migration shipped after Phase 5 has soaked for one release cycle:
- `DROP TABLE` for `period_structures`, `period_slots`, `class_period_structure`, `shared_resources`, `timetable_slots`, `lesson_plans`, `academic_calendar`
- Drop the compatibility shim's "fallback to old behavior" branches; keep only the new-table reads (preserves the public API of `currentAcademicYear()` etc. permanently)
- Ships only after manual verification that no code paths read from the old tables.

### 5.7 What does NOT change (the contract for external modules)

These public APIs stay identical in signature and return shape:

| API | Used by |
|---|---|
| `currentAcademicYear(): string` | ~30 files (Exams, Attendance, Reports, Dashboard, Students, Subjects, etc.) |
| `useAcademicCalendar()` | Calendar consumers across roles |
| `useSyllabusCoverage(classId, subjectId)` | Syllabus pages, exam paper generator |
| Routes `/teacher/my-week`, `/student/my-week`, `/school/timetable`, `/school/calendar`, `/school/period-structures` (redirect), `/school/shared-resources` | Bookmarks, sidebar links, dashboard tiles |

The implementation behind them changes; the surface does not. External modules do not need to know we did the rebuild.

### 5.8 What we accept will change (intentional, scoped)

- `AppSidebar.tsx` group labels stay identical ("Academic" group still contains Calendar; "Operations" still contains Timetable). Only the route handlers change.
- `RoleBasedDashboard` and feature-tile pointers may need a one-line update if any tile deep-links into a dropped sub-route.
- `FEATURE_URL_MAP` updated to reflect any new sub-paths (e.g., `/school/timetable/structures` → `/school/timetable?gear=structures`).
- Edge function callers: only `useCopyTimetableYear` calls the old `copy-timetable-template`; it is part of the rebuilt module so this is in-scope.

---

## 6. Testing strategy

- **DB:** Unit tests on `tt_backfill_from_legacy()` with seeded fixtures (idempotent, preserves IDs, handles edge cases like classes with no structure or lesson plans without an owner).
- **Compat shim:** Snapshot tests on `currentAcademicYear()` and `useSyllabusCoverage()` returning identical shapes pre/post migration.
- **UI:** Playwright smoke tests for the three role flows:
  1. Admin creates a structure, assigns it to 3 classes, sets up calendar (holiday + exam block).
  2. Coordinator opens a class workspace, fills all required cells, publishes.
  3. Teacher sees the published slots in `/teacher/my-week`, marks a lesson plan `done`.
- **Substitution path:** Playwright test — coordinator marks a substitute for a future date, both teachers receive notifications, original teacher's plan stays `planned` until cron flips it.
- **Manual:** Test the `data-dirty="true"` SW dirty-form path on the new slot drawer (per CLAUDE.md §17). Confirm autosave on the new lesson plan panel (24h localStorage, per `lessonPlanDraft.ts` pattern).
- **Regression:** Before Phase 6 drop, grep the codebase for any remaining `from("period_structures")`, `from("timetable_slots")`, `from("lesson_plans")`, `from("academic_calendar")`, etc. Must return zero hits.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Old data has corrupted/orphan rows that backfill skips | Backfill script logs all skipped rows; manual review before Phase 5. |
| Compat shim drifts from old behavior in subtle ways | Snapshot tests + parallel-run period (Phase 4 → 5). |
| External edge functions reference old table names | Searched: none reference timetable tables. Confirmed in CLAUDE.md §22 footer ("section-level edge functions continue to key off `class_id`"). Calendar `academic_calendar` table read by `get-working-days` edge function — must be either updated to read `cal_events` in Phase 4, or fronted by a SQL VIEW for back-compat in Phase 1. |
| Mid-migration crash leaves DB inconsistent | Phase 2 backfill in single transaction; Phase 6 drop in separate migration after soak time. |
| RLS recursion (per CLAUDE.md §22) when policies on `tt_slots` and `tt_lesson_plans` reference each other | Wrap any cross-table RLS check in a SECURITY DEFINER helper function from the start (don't inline `EXISTS` between the two). |
| Cron-based `tt-notify-absence-pending` misses a day if the function fails | Run idempotently — query for any slot+date matching the criteria regardless of when last run; safe to skip a day and catch up the next. |
| Old students/teachers have bookmarked sub-routes (e.g., `/school/period-structures`) | Keep `<Navigate>` redirects in router for one full release cycle. |
| Conflict engine in `timetableConflicts.ts` not fully ported | Port as-is from `src/lib/timetableConflicts.ts` and `src/lib/resourceAvailability.ts`; both already match new schema's column names with minor adjustments (cast targets change from `timetable_slots` to `tt_slots`). |

---

## 8. Out of scope

- **Fees, exam grading, attendance, predictions, OCR, AI question generation** — untouched. None of these consume timetable or calendar data directly.
- **Heavy substitution / absence-tracker module** (Q6 option C) — out of scope. Light substitution (Q6 option B) is in.
- **Term/semester support** — explicitly removed per user direction ("remove the term system if possible").
- **Wing-scoped events on the calendar** — out of scope. All calendar entries are school-wide.
- **Drag-and-drop slot assignment** — out of scope (mobile-first design preference).
- **Per-grade or per-section term boundaries** — n/a, no terms.

---

## 9. Open questions / deferred decisions

None at design time. All Q1–Q6 user decisions captured above. Implementation plan (next step) will surface tactical decisions per migration file and per component.

---

## 10. Decision log (Q&A summary)

| # | Question | Decision |
|---|---|---|
| Q1 | Scope of "no other tabs affected" | **B** — `/teacher/my-week` and `/student/my-week` rebuilt as part of timetable; `currentAcademicYear()` etc. preserved via compat shim. |
| Q2 | Why rebuild | **A + C + D** — UX confusion, missing features (substitution, draft/publish, status visibility), mobile-first. |
| Q3 | Slot definition | **A + B blended** — both teacher and subject required; teacher dropdown filtered to those who teach the chosen subject; multi-subject teachers can appear in multiple subject pickers. |
| Q3.i | Non-academic slot types preserved | Yes — Break, Assembly, Sports, Library, Practical, Free retained. |
| Q3.ii | Shared resources in scope | Yes — full pool model with capacity rebuild. |
| Q3.iii | One vs many period structures | Multiple, with multi-class bulk assignment in one operation. |
| Q4 | Calendar contents | **A + C + E + F** — AY boundaries, Holidays, Exam blocks, Events. **B (terms) dropped.** D (working-day exceptions) skipped for simplicity. |
| Q4.i | Calendar edit permission | Admin only. |
| Q4.ii | Term scope | N/A — terms removed. |
| Q5 | Publish workflow | **A** — Draft → Published one-way; edits after publish go live immediately. Per-class draft scope. |
| Q6 | Substitutions | **B** — Light substitution. Original teacher's lesson plan unchanged by substitute; flips to `pending` next day if not resolved; notifications fired; teacher resolves manually. |
| Approach | Page architecture | **B** — Per-Class Workspace (class list home → workspace per class, gear icon for setup). |
| Cross-cutting (1) | Draft scope | Per-class. |
| Cross-cutting (2) | Slot interaction | Tap → drawer (mobile-first). |
