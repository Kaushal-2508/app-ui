# Olympiad Batches v2 — Two-Panel Batch Builder (Design)

**Date:** 2026-06-09
**Status:** Approved (design) — pending implementation plan
**Surface:** `/school/olympiad/batches` (all Olympiad schools — existing-SALCI and onboarded)

## Problem

Today's Batches tab is an *auto-generate-then-tweak* flow:

1. Admin fills a form (`BatchScheduleInputs`): one PC count, a date **range**, day start/end, buffer.
2. Edge function `oly-generate-batch-schedule` greedily splits **each class** into PC-sized batches (one grade per batch), auto-placed across time slots.
3. Admin drag-reorders cards in a Kanban (`BatchKanban`/`BatchCard`) and hits **Lock**.

This is opaque (the admin can't see *how many students per class still need seating*), rigid (one class per batch wastes PCs when classes are small), and indirect (you tune dates/times by dragging, not by setting them).

## Goal

A direct, manual **two-panel batch builder**: interactive batch cards on the left, a live "students remaining per class" panel on the right. Admin builds batches card by card, assigning whole classes, watching the remaining counts tick to zero, then locks. A one-tap **Auto-fill** seeds a complete starting schedule using the same rule.

## Decisions (locked with user)

| Decision | Choice |
|---|---|
| Scope | **All** Olympiad schools (replace the current Kanban builder everywhere). |
| Automation | **Manual builder + Auto-fill helper.** |
| Seating rule | **Whole-class fill** (see below). |

## Seating rule — "Whole-class fill" (precise)

Lab capacity = `pcCount` (per school). For a batch, `free = pcCount − (students already assigned to that batch)`. When the admin picks a class to add to a batch (where `class.remaining` = enrolled − already-assigned-anywhere):

- **`class.remaining ≤ free`** → the whole class is added to the batch.
- **`class.remaining > free`:**
  - **batch is empty** (`free === pcCount`) → the class pours in to fill all PCs; the overflow becomes that class's new `remaining` (must go in a later batch). *This is the only way a class splits — at a clean batch boundary.*
  - **batch is non-empty** → **blocked.** In the "+ Add class" menu the class is disabled with a reason: *"Class 9 (12 left) won't fit in 8 free PCs — start a new batch."*

**Worked example** (lab = 20; Class 10 = 25, Class 9 = 10):
- Add Class 10 to empty Batch 1 → 20 seated, **5 overflow**.
- Add Class 9 (10) to empty Batch 2 → 10 seated, 10 free.
- Top up Batch 2 with the 5 Class-10 leftovers (5 ≤ 10) → 15/20, 5 idle PCs.
- Save (idle PCs allowed). All 35 seated → schedule complete.

**Completion gate:** the **Lock schedule** button is disabled until **every class's remaining = 0**, every batch has a date + start time, and there are no empty batches (empties are pruned on lock). Button hint while incomplete: *"6 students still unassigned."*

## Layout

Shown when `school.status === 'enrollment_closed' && !hasLocked` (same gate as today). Built on existing primitives (`surface-card`, `frosted-shadow`, `rounded-card`, `StatTile`, shadcn `Input`/`Select`/`Popover`), mobile-first per CLAUDE.md §20.

```
LEFT — build area                          RIGHT — Students remaining (sticky)
┌──────────────────────────────┐           ┌───────────────────────────┐
│ Lab capacity: [20] PCs  [Auto-fill]       │ Class 10   20/25  ▓▓▓░     │
│                              │            │ Class 9    10/10  ▓▓▓▓     │
│ ┌─ Batch 1 ───────────────┐  │            │ Class 8     0/30  ░░░░     │
│ │ 📅 9 Jun  🕐 09:00       │  │            ├───────────────────────────┤
│ │ Class 10 · 20  [20/20]   │  │            │ 30 unassigned             │
│ │ [+ Add class]  FULL      │  │            │ [ Lock schedule ]  ← gated│
│ └──────────────────────────┘ │            └───────────────────────────┘
│ ┌─ Batch 2 ───────────────┐  │
│ │ 📅 9 Jun  🕐 11:00       │  │
│ │ Class 9 · 10             │  │
│ │ Class 10 · 5 (overflow)  │  │
│ │ [+ Add class]  15/20     │  │
│ └──────────────────────────┘ │
│ [ + Add batch ]              │
└──────────────────────────────┘
```

- **Mobile (< lg):** right panel collapses into a sticky summary chip (`N unassigned`) that opens the per-class list as a `MobileSheet`; cards stack below.
- **Batch card** (`BatchBuilderCard`): date picker (`Input type=date`) + start-time picker (`Input type=time`); window end = start + campaign `exam_duration_minutes`, shown read-only; the list of assigned class-chunks with counts and a remove (×) per chunk; a capacity bar `X / pcCount PCs`; "+ Add class" (`AddClassMenu`); remove-batch.
- **`AddClassMenu`:** dropdown of classes with `remaining > 0`, each showing "Class 9 · 10 left"; an item is disabled (with the blocked-reason tooltip) when the whole-class-fill rule forbids adding it to *this* batch.

## Data model & state

Pure builder state (no server round-trip until lock):

```ts
type BatchClass = { gradeLevelId: string; classLabel: string; studentIds: string[] }; // ordered by roll_number
type Allocation = { gradeLevelId: string; classLabel: string; studentIds: string[] }; // a chunk seated in a batch
type BuilderBatch = { id: string; date: string; startTime: string; allocations: Allocation[] };
```

- **Roster source:** new hook `useOlympiadBatchingRoster(olySchoolId)` — **cursor-paginated** (pages of 1000, §23-safe; needed because a large school's roster exceeds the 1000-row PostgREST cap), explicit columns `id, grade_level_id, class_label, roll_number`, `status = 'active'`, ordered by `(class_label, roll_number)`. Grouped client-side into `BatchClass[]`.
- **Remaining(class)** = `studentIds.length − (sum of that class's allocation lengths across all batches)`, computed live.
- **Unassigned student IDs for a class** = `class.studentIds` minus all IDs already in that class's allocations; "add" takes the first `take` of these in order so splits are deterministic.
- **Seating logic** lives in a pure, unit-tested module `src/lib/olympiad/batchSeating.ts` (`canAddClass`, `addClassToBatch`, `removeAllocation`, `autoFill`, `remainingByClass`, `batchFree`). Zero React — fully testable.

## Persistence (lock)

Reuses `oly-lock-batch-schedule` with the existing `DraftBatch` shape (`scheduled_at, grade_level_id, student_ids, pc_count, batch_label`). Per batch:
- `student_ids` = flattened allocations.
- `grade_level_id` = the single class's grade for a single-class batch, **`null` for a mixed batch** (already nullable; NULLs are distinct under the `unique(oly_school_id, scheduled_at, grade_level_id, is_absentees)` constraint, so concurrent mixed batches don't collide).
- `batch_label` = `"Batch N — Class 10"` (single) or `"Batch N — Class 9, Class 10"` (mixed). This is the only thing PIN custody renders per batch, so the label must be descriptive.
- `pc_count` = school `pcCount`.
- `scheduled_at` = `${date}T${startTime}:00+05:30` → ISO (IST), same convention as the existing generator.

**Edge-function change:** widen the Deno `Input` type to `grade_level_id: string | null` (runtime already inserts whatever is passed; no SQL change). Redeploy.

## Schema change (one column only)

`oly_schools.pc_count integer null check (pc_count is null or pc_count > 0)` — the lab capacity, remembered between visits. The "Lab capacity" field reads/writes it via a new `useUpdateOlympiadPcCount` mutation (school-admin RLS already covers `oly_schools`). Add to generated `types.ts`. **No FK added, no index needed** (single-row-per-school read on an already-indexed PK).

> Verified: `grade_level_id` on `oly_batches` is already nullable; the only renderer of a batch's grade was the retired `BatchCard`. `PinCustodyRow` uses `batch_label`; `oly-generate-credentials-pdf` and pre-exam reminders key off `oly_students`/assignments, not the batch grade. So mixed batches need no migration beyond the unchanged label path.

## Auto-fill

Client-side, same rule, greedy: clear the board, sort classes by `remaining` descending, then repeatedly — open a batch, pour classes/leftovers that fit until full or none fit, open the next — until all seated. Dates/times left blank (admin sets them) or stubbed to campaign defaults. Replaces `oly-generate-batch-schedule`, which goes **dormant** (left in place, no longer called).

## Out of scope (unchanged)

Absentees tab + `is_absentees` batches; PIN custody; the post-lock read-only summary (State 3); student PIN/exam flow; reminders/credentials PDFs.

## File structure

**New**
- `src/lib/olympiad/batchSeating.ts` — pure seating logic (+ `batchSeating.test.ts`).
- `src/hooks/olympiad/useOlympiadBatchingRoster.ts` — paginated roster → `BatchClass[]`.
- `src/hooks/olympiad/useUpdateOlympiadPcCount.ts` — persist `oly_schools.pc_count`.
- `src/components/olympiad/school/BatchBuilder.tsx` — orchestrator (state, panels, lock).
- `src/components/olympiad/school/BatchBuilderCard.tsx` — one batch card.
- `src/components/olympiad/school/RemainingPanel.tsx` — right-side remaining list + lock gate.
- `src/components/olympiad/school/AddClassMenu.tsx` — add-class dropdown with rule-aware disabling.

**Edit**
- `src/pages/school/olympiad/OlympiadSchoolBatchesPage.tsx` — swap States 2a/2b (inputs + Kanban) for `<BatchBuilder>`; keep States 1 and 3.
- `supabase/functions/oly-lock-batch-schedule/index.ts` — `grade_level_id: string | null`.
- `src/integrations/supabase/types.ts` — add `oly_schools.pc_count`.
- New migration `supabase/migrations/<ts>_oly_school_pc_count.sql`.

**Retire (delete once unreferenced)**
- `BatchScheduleInputs.tsx`, `BatchKanban.tsx`, `BatchCard.tsx`, `LockScheduleDialog.tsx` (replaced by an inline confirm in `RemainingPanel`/`BatchBuilder`), `useGenerateBatchSchedule.ts` usage.

## Testing

- Unit (Vitest): `batchSeating.ts` — fit-exactly, overflow-from-empty, block-on-non-empty, top-up-leftovers, remove frees students, auto-fill seats everyone, deterministic slicing by roll order. The worked example is a fixture.
- Manual smoke: 375px + desktop; light/dark; a single-class school, a mixed-overflow school, a school with one class > pcCount; lock → PIN custody shows descriptive labels; student PIN entry still validates.
- Gate (§5a): `npm run typecheck`, `npx eslint <touched>`, `npx vite build` all exit 0.
