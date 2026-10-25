# Timetable — "Other" custom-label slot type

**Date:** 2026-07-25
**Area:** Timetable / Class Workspace
**Status:** Design approved, ready for implementation plan

## Motivation

The Class Workspace slot drawer currently offers a fixed set of slot types
(`theory`, `practical`, `library`, `sports`, `arts`, `assembly`, `free`,
`break`). Schools regularly want to mark a cell as something outside that
enum — Lunch, Football Practice, Yoga, Prayer, Club — without polluting
`assembly` or `free`. Today the only workaround is to abuse `notes`, which
does not surface in the cell display or in teacher/student week views.

## Goal

Add a single `Other` slot type whose label is free-text supplied per cell.
The custom label appears wherever any other slot label appears (admin grid,
teacher week, student week, print). Behaves identically to `assembly` in
every other respect: no subject, no teacher, no teacher-load count, no
conflict logic.

## Non-goals (YAGNI)

- No school-wide reusable list of custom slot types.
- No autosuggest of previously-used labels.
- No back-migration of existing `assembly` rows into `other`.
- No per-cell icon or per-label color — a single tint covers all `other` cells.
- No new lesson-plan / syllabus-coverage semantics — `other` never carries a
  subject, so it is invisible to those pipelines by construction.

## Design

### Schema

One migration `supabase/migrations/YYYYMMDDHHMMSS_tt_slots_other_type.sql`:

1. Extend the CHECK constraint (drop + recreate — the current name is
   `tt_slots_type_chk`):
   ```sql
   ALTER TABLE public.tt_slots DROP CONSTRAINT tt_slots_type_chk;
   ALTER TABLE public.tt_slots ADD CONSTRAINT tt_slots_type_chk
     CHECK (slot_type IN ('theory','practical','library','sports','arts',
                          'assembly','free','break','other'));
   ```
2. Add a nullable column with two guards:
   ```sql
   ALTER TABLE public.tt_slots ADD COLUMN custom_label TEXT;
   ALTER TABLE public.tt_slots ADD CONSTRAINT tt_slots_custom_label_scope_chk
     CHECK (custom_label IS NULL OR slot_type = 'other');
   ALTER TABLE public.tt_slots ADD CONSTRAINT tt_slots_custom_label_len_chk
     CHECK (custom_label IS NULL OR
            char_length(btrim(custom_label)) BETWEEN 1 AND 40);
   ```

No data backfill. No new index (this column is display-only, never a filter).

RLS is untouched — the four existing `tt_slots` policies already cover the
column implicitly (SELECT/UPDATE on the row).

### Types & hooks (`src/hooks/useTimetableV2.ts`)

- Extend the `SlotType` union to include `'other'`.
- Add `custom_label: string | null` to `ResolvedSlotV2` and `SaveTtSlotInput`.
- Every `select("…")` that projects `tt_slots` gains `, custom_label` — this
  covers `useClassWorkspaceV2`, `useTeacherWeekV2`, `useStudentWeekV2`, and
  any other reader that maps to `ResolvedSlotV2`. Grep for the current
  projection string in the hook file to find all callsites.
- `useSaveTtSlot` writes `custom_label` in the upsert payload; it MUST send
  `null` unless `slot_type === 'other'` so the DB scope CHECK is honored.

### Slot drawer (`src/components/timetable-v2/SlotDrawerV2.tsx`)

- Add `other: "Other"` to `SLOT_TYPE_LABEL`. Rendered after `Assembly` in
  the picker; `break` and `library` remain filtered out per current code.
- New local state `customLabel: string`, seeded from
  `existingSlot?.custom_label ?? ""` in the reset-on-open effect.
- When `slotType === 'other'`, render a single `<Input>` labeled
  `"Custom label"` with placeholder `"e.g. Lunch, Football, Yoga"` and
  `maxLength={40}`. Placed where the Subject picker sits for academic
  types.
- `canSubmit` gains `&& (slotType !== 'other' || customLabel.trim().length > 0)`.
- Switch handlers: picking `'other'` clears `subjectId` + `teacherId`;
  picking any non-`'other'` type clears `customLabel`.
- `handleSave` sends `custom_label: slotType === 'other' ? customLabel.trim() : null`.
- Existing `data-dirty="true"` contract stays — no change.

### Grid (`src/components/timetable-v2/TimetableGridV2.tsx`)

- Add a distinct tint:
  `other: "bg-violet-50 text-violet-900 hover:bg-violet-100 border-violet-200"`.
- Cell content rule changes from
  ```tsx
  {existing.subject_name ?? labelForType(existing.slot_type)}
  ```
  to
  ```tsx
  {existing.slot_type === 'other'
    ? (existing.custom_label ?? 'Other')
    : (existing.subject_name ?? labelForType(existing.slot_type))}
  ```
- `labelForType('other')` returns `'Other'` as a defensive fallback; DB
  constraints prevent this from firing in practice.
- No changes to `TYPE_TINT` for existing types, so this is additive.

### Other rendering surfaces

Apply the same `slot_type === 'other' ? custom_label : …` rule in:

- Teacher My Week view (whichever component renders `ResolvedSlotV2` cells;
  `useTeacherWeekV2`'s consumer)
- Student My Week view (`StudentWeekPageV2`)
- Print view (`TimetablePrintViewV2`)

All three already have a subject-or-type fallback line — the change is
inserting one branch above it.

### Untouched surfaces

- `SubstituteDialogV2`, `LessonPlanDialogV2` — don't render slot type text.
- `useSyllabusCoverage` / `syllabusCoverage.ts` — filters on
  `session_type='teaching' AND status='done'`; `other` rows have no
  subject and never generate lesson plans in the teaching pipeline.
- `useTeacherLoadV2` — counts by teacher; `other` has no teacher.
- `copy-timetable-template` edge function — copies the full row shape, so
  `custom_label` rides along automatically once the column exists.
- Optional-band branch — unchanged. Band cells still save as `'free'` +
  `is_optional_band=true`, so the `other` type and the band feature are
  orthogonal.

### Types regen

Per `CLAUDE.md §5a`, after applying the migration:

```
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
```

Skipping this leaves generated types out of sync and forces `as any` casts.

## Error surfaces

- Drawer with empty label + Other selected: Save button disabled (client
  gate). No toast needed — mirrors the existing "no subject picked" behavior
  for academic types.
- Anything that bypasses the drawer (import, cron copy, edge function) and
  writes `slot_type='other'` with NULL/blank `custom_label` will be rejected
  by the CHECK constraint. Any such writer must route through the shared
  `useSaveTtSlot` path or set the label explicitly — the constraint failure
  travels through `toastError` per §19.

## Success criteria

1. Admin picks "Other", types "Lunch", saves → cell reads "Lunch" on the
   admin grid, teacher's My Week, student's My Week, and print view.
2. Save button disabled while custom label is empty/whitespace when Other
   is selected.
3. DB rejects direct `INSERT` of `slot_type='other'` with NULL or blank
   `custom_label`.
4. Existing rows (all 8 legacy types) render unchanged.
5. Switching type Other → Assembly clears the label; Assembly → Other
   clears any prior subject/teacher.
6. `npm run typecheck`, `npx eslint <changed-paths>`, `npx vite build` —
   all exit 0 (§5a hard contract).

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/<ts>_tt_slots_other_type.sql` | New — CHECK extension + `custom_label` column + guards |
| `src/hooks/useTimetableV2.ts` | `SlotType` union, `ResolvedSlotV2`/`SaveTtSlotInput` shape, select projections, `useSaveTtSlot` payload |
| `src/components/timetable-v2/SlotDrawerV2.tsx` | `Other` option, `customLabel` state + input, clear-on-switch, save wiring |
| `src/components/timetable-v2/TimetableGridV2.tsx` | `TYPE_TINT.other`, cell-content branch, `labelForType('other')` |
| `src/components/timetable-v2/TimetablePrintViewV2.tsx` | Cell-content branch |
| Teacher My Week component | Cell-content branch |
| `src/pages/student/StudentWeekPageV2.tsx` | Cell-content branch |
| `src/integrations/supabase/types.ts` | Regen after migration |

Estimated delta: 1 migration + ~60 LOC across the components/hooks.

## Rollout

1. Apply migration via Supabase Management API (per
   `reference_migration_ledger_stale` — do NOT rely on `supabase db push`).
2. Verify the CHECK + column landed via `information_schema`.
3. Regen types, run typecheck + ESLint on touched files + build.
4. Deploy frontend.

No feature flag — the feature is additive and the drawer picker gains a
single new option. Existing rows and behaviors are unaffected until
someone picks "Other".
