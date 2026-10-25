# Timetable "Other" Slot Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `Other` slot type to the Class Workspace that lets an admin/coordinator type a free-text label (e.g. Lunch, Football, Yoga) and have it appear in the admin grid, teacher's My Week, student's My Week, and print view — behaving like `assembly` in every other respect.

**Architecture:** One migration extends `tt_slots.slot_type` CHECK to include `'other'` and adds a nullable `custom_label TEXT` with two guards (label-only-when-Other, non-empty trimmed length 1–40). Frontend adds `'other'` to the `SlotType` union, threads `custom_label` through every `ResolvedSlotV2` projection and the save mutation, renders a text input in the slot drawer when Other is picked, and applies a single display rule (`slot_type === 'other' ? custom_label : <existing>`) in three render surfaces.

**Tech Stack:** Supabase Postgres, PostgREST, TanStack Query v5, React 18 + TypeScript, shadcn/ui, Tailwind. Repo has NO test framework — verification is `npm run typecheck` + `npx eslint <paths>` + `npx vite build` + manual browser walkthrough per CLAUDE.md §5a.

**Design spec:** [docs/superpowers/specs/2026-07-25-timetable-other-slot-type-design.md](../specs/2026-07-25-timetable-other-slot-type-design.md)

## Global Constraints

- **Zero-error contract (§5a):** on every changed file, `npm run typecheck`, `npx eslint <path>`, and `npx vite build` MUST exit 0. Never silence with `// eslint-disable-next-line`, `as any`, or by editing `eslint.config.*`. `prefer-const` and `@typescript-eslint/no-explicit-any` are HARD errors.
- **Never use `npx tsc --noEmit`** — root tsconfig has `files:[]` + project refs and always exits 0. Use `npm run typecheck`.
- **Migration ledger is stale (reference memory):** apply prod migrations via Supabase Management API SQL + verify via `information_schema` — do NOT rely on `supabase db push`.
- **Error toasts route through `toastError`** ([src/lib/toast.ts](../../src/lib/toast.ts)) — never `toast.error(error.message)` (§19).
- **shadcn/ui only** — no raw HTML `<input>`; use `@/components/ui/input` `Input`.
- **`data-dirty="true"`** stays on `SlotDrawerV2`'s `<form>` for the SW dirty-form contract (§17).
- **Sub­pabase project ref:** `gyymkgohcijeksmrzuyw`. All migrations + type regen target this ref.
- **CHECK constraint name that already exists:** `tt_slots_type_chk` (from [supabase/migrations/20260424100000_tt_cal_phase1_schema.sql:176](../../supabase/migrations/20260424100000_tt_cal_phase1_schema.sql#L176)). Must be dropped and recreated — you cannot ALTER a CHECK in place.

---

### Task 1: Migration + type regen

**Files:**
- Create: `supabase/migrations/<TIMESTAMP>_tt_slots_other_type.sql` — replace `<TIMESTAMP>` with `YYYYMMDDHHMMSS` at creation time (e.g. `20260725120000`).
- Modify: `src/integrations/supabase/types.ts` — regenerated wholesale after the migration is applied to prod.

**Interfaces:**
- Consumes: nothing.
- Produces: DB accepts `slot_type='other'`. DB accepts `custom_label` (nullable TEXT, only when slot_type='other', trimmed length 1–40). Generated types add `'other'` to `tt_slots.Row.slot_type` and a `custom_label: string | null` field.

- [ ] **Step 1: Write the migration file**

Path: `supabase/migrations/20260725120000_tt_slots_other_type.sql` (bump the timestamp if a newer file already exists on your branch — must sort last).

```sql
-- Extend tt_slots.slot_type to allow 'other' with a required free-text label.
--
-- Design: docs/superpowers/specs/2026-07-25-timetable-other-slot-type-design.md
--
-- The existing CHECK constraint tt_slots_type_chk was created in
-- 20260424100000_tt_cal_phase1_schema.sql:176. Postgres has no ALTER CHECK,
-- so we drop and recreate.

BEGIN;

ALTER TABLE public.tt_slots
  DROP CONSTRAINT IF EXISTS tt_slots_type_chk;

ALTER TABLE public.tt_slots
  ADD CONSTRAINT tt_slots_type_chk
  CHECK (slot_type IN (
    'theory','practical','library','sports',
    'arts','assembly','free','break','other'
  ));

ALTER TABLE public.tt_slots
  ADD COLUMN IF NOT EXISTS custom_label TEXT;

-- custom_label is only meaningful when slot_type='other'.
ALTER TABLE public.tt_slots
  DROP CONSTRAINT IF EXISTS tt_slots_custom_label_scope_chk;
ALTER TABLE public.tt_slots
  ADD CONSTRAINT tt_slots_custom_label_scope_chk
  CHECK (custom_label IS NULL OR slot_type = 'other');

-- When present, custom_label must be a non-blank string, 1–40 chars trimmed.
-- Prevents empty-string or whitespace-only labels bypassing the UI gate.
ALTER TABLE public.tt_slots
  DROP CONSTRAINT IF EXISTS tt_slots_custom_label_len_chk;
ALTER TABLE public.tt_slots
  ADD CONSTRAINT tt_slots_custom_label_len_chk
  CHECK (custom_label IS NULL
         OR char_length(btrim(custom_label)) BETWEEN 1 AND 40);

COMMENT ON COLUMN public.tt_slots.custom_label IS
  'Free-text label shown in the cell when slot_type=other (e.g. Lunch, Football). Required when slot_type=other; must be NULL otherwise.';

COMMIT;
```

- [ ] **Step 2: Apply the migration to prod via Management API**

Two paths — pick whichever you already have wired.

**Path A — mgmt-api SQL (preferred per `reference_migration_ledger_stale`):**
Use the existing helper in your environment (e.g. `scripts/run-sql.ps1` or a mgmt-api POST). The SQL body is the entire migration file contents.

**Path B — `supabase db push`:**
Only if the ledger on this project has been proven current. Run:
```
npm run db:status
```
If migrations are in sync, `npm run db:push`. If not, use Path A.

- [ ] **Step 3: Verify the CHECK + column landed**

Run against prod (via mgmt-api SQL or `psql`):

```sql
-- Should return one row containing 'other'
SELECT conname, pg_get_constraintdef(oid)
FROM   pg_constraint
WHERE  conrelid = 'public.tt_slots'::regclass
  AND  conname IN ('tt_slots_type_chk',
                   'tt_slots_custom_label_scope_chk',
                   'tt_slots_custom_label_len_chk')
ORDER BY conname;

-- Should list the new column
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'tt_slots'
  AND  column_name  = 'custom_label';
```

Expected: three rows in the first query (all three constraints), one row in the second (`custom_label`, `text`, `YES`).

- [ ] **Step 4: Sanity-write a negative case to prove the CHECK bites**

```sql
-- Both should raise:
--   new row for relation "tt_slots" violates check constraint …
BEGIN;
  INSERT INTO public.tt_slots (institution_id, class_id, period_slot_id, day, academic_year, slot_type, custom_label)
  VALUES ('00000000-0000-0000-0000-000000000000',
          '00000000-0000-0000-0000-000000000000',
          '00000000-0000-0000-0000-000000000000',
          'monday', '2026-27', 'other', '');
ROLLBACK;

BEGIN;
  INSERT INTO public.tt_slots (institution_id, class_id, period_slot_id, day, academic_year, slot_type, custom_label)
  VALUES ('00000000-0000-0000-0000-000000000000',
          '00000000-0000-0000-0000-000000000000',
          '00000000-0000-0000-0000-000000000000',
          'assembly', 'Assembly');
ROLLBACK;
```

Both statements should error out (the FKs will also fail, but the CHECK errors should surface first — read the error text to confirm it names `tt_slots_custom_label_len_chk` and `tt_slots_custom_label_scope_chk`).

- [ ] **Step 5: Regen Supabase types**

Run:
```
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
```

Then confirm the diff includes:
- `slot_type` union in the `tt_slots` Row/Insert/Update types adds `"other"`.
- New `custom_label: string | null` field on all three (Row/Insert/Update).

If either is missing, the migration didn't apply — re-run Step 2 and re-verify Step 3 before regenerating.

- [ ] **Step 6: Verify typecheck still passes after regen (no changes yet)**

```
npm run typecheck
```

Expected: exit 0. Any errors here mean the regen removed or renamed types that pre-existing code relied on — do NOT proceed until this is clean.

- [ ] **Step 7: Commit**

```
git add supabase/migrations/20260725120000_tt_slots_other_type.sql src/integrations/supabase/types.ts
git commit -m "feat(timetable): schema for 'other' slot type + custom_label column"
```

---

### Task 2: Hook layer — SlotType union, ResolvedSlotV2, save payload, all projections

**Files:**
- Modify: `src/hooks/useTimetableV2.ts` — union at ~L308, `ResolvedSlotV2` at ~L343, `TeacherWeekSlot` at ~L578, `SaveTtSlotInput` at ~L508, `useSaveTtSlot` upsert body at ~L527, three `tt_slots` select strings + row mappers (`useClassWorkspaceV2` ~L412, `useTeacherWeekV2` ~L610, `useStudentWeekV2` ~L818).

**Interfaces:**
- Consumes: Task 1's regenerated types (has `'other'` in the enum + `custom_label` field).
- Produces:
  - `SlotType` now includes `'other'`.
  - `ResolvedSlotV2` has `custom_label: string | null`.
  - `TeacherWeekSlot` has `custom_label: string | null`.
  - `SaveTtSlotInput` has `custom_label: string | null`.
  - `useSaveTtSlot` persists `custom_label` in the upsert payload.
  - All three tt_slots read projections return `custom_label`.

- [ ] **Step 1: Extend the `SlotType` union**

In `src/hooks/useTimetableV2.ts` around line 308, change:

```ts
export type SlotType =
  | "theory" | "practical" | "library" | "sports"
  | "arts"   | "assembly"  | "free"    | "break";
```

to:

```ts
export type SlotType =
  | "theory" | "practical" | "library" | "sports"
  | "arts"   | "assembly"  | "free"    | "break"
  | "other";
```

- [ ] **Step 2: Add `custom_label` to `ResolvedSlotV2`**

Around line 343, in the `ResolvedSlotV2` interface, add the field right after `notes: string | null;`:

```ts
export interface ResolvedSlotV2 {
  id: string;
  class_id: string;
  period_slot_id: string;
  day: Weekday;
  academic_year: string;
  slot_type: SlotType;
  subject_id: string | null;
  teacher_id: string | null;
  resource_id: string | null;
  notes: string | null;
  custom_label: string | null;
  subject_name: string | null;
  teacher_name: string | null;
  /** Optional band cell — each student sees their own enrolled optional here. */
  is_optional_band?: boolean;
}
```

- [ ] **Step 3: Add `custom_label` to `SaveTtSlotInput`**

Around line 508:

```ts
export interface SaveTtSlotInput {
  id?: string;
  class_id: string;
  period_slot_id: string;
  day: Weekday;
  academic_year: string;
  slot_type: SlotType;
  subject_id: string | null;
  teacher_id: string | null;
  resource_id: string | null;
  notes: string | null;
  custom_label: string | null;
  is_optional_band?: boolean;
}
```

- [ ] **Step 4: Persist `custom_label` in `useSaveTtSlot`**

Around line 527, extend the upsert body:

```ts
const { data, error } = await supabase
  .from("tt_slots" as never)
  .upsert(
    {
      ...(input.id ? { id: input.id } : {}),
      institution_id: institutionId!,
      class_id: input.class_id,
      period_slot_id: input.period_slot_id,
      day: input.day,
      academic_year: input.academic_year,
      slot_type: input.slot_type,
      subject_id: input.subject_id,
      teacher_id: input.teacher_id,
      resource_id: input.resource_id,
      notes: input.notes,
      custom_label: input.custom_label,
      is_optional_band: input.is_optional_band ?? false,
    } as never,
    { onConflict: "class_id,period_slot_id,day,academic_year" },
  )
  .select()
  .single();
```

- [ ] **Step 5: Add `custom_label` to `useClassWorkspaceV2` read**

Around line 412, the select string. Change from:

```ts
.select(
  "id, class_id, period_slot_id, day, academic_year, slot_type, subject_id, teacher_id, resource_id, notes, is_optional_band, subject:universal_subjects!tt_slots_subject_id_fkey(id, name), teacher:profiles!tt_slots_teacher_id_fkey(id, full_name)",
)
```

to:

```ts
.select(
  "id, class_id, period_slot_id, day, academic_year, slot_type, subject_id, teacher_id, resource_id, notes, custom_label, is_optional_band, subject:universal_subjects!tt_slots_subject_id_fkey(id, name), teacher:profiles!tt_slots_teacher_id_fkey(id, full_name)",
)
```

Then extend the local `SlotRaw` type (around line 417) and the mapper (around line 432):

```ts
type SlotRaw = {
  id: string;
  class_id: string;
  period_slot_id: string;
  day: Weekday;
  academic_year: string;
  slot_type: SlotType;
  subject_id: string | null;
  teacher_id: string | null;
  resource_id: string | null;
  notes: string | null;
  custom_label: string | null;
  is_optional_band: boolean | null;
  subject: { id: string; name: string } | null;
  teacher: { id: string; full_name: string | null } | null;
};
const slots: ResolvedSlotV2[] = ((slotRows ?? []) as unknown as SlotRaw[]).map((r) => ({
  id: r.id,
  class_id: r.class_id,
  period_slot_id: r.period_slot_id,
  day: r.day,
  academic_year: r.academic_year,
  slot_type: r.slot_type,
  subject_id: r.subject_id,
  teacher_id: r.teacher_id,
  resource_id: r.resource_id,
  notes: r.notes,
  custom_label: r.custom_label,
  subject_name: r.subject?.name ?? null,
  teacher_name: r.teacher?.full_name ?? null,
  is_optional_band: r.is_optional_band ?? false,
}));
```

- [ ] **Step 6: Add `custom_label` to `useStudentWeekV2` read**

Around line 818, mirror the change from Step 5:

Select string — add `custom_label` between `notes` and `is_optional_band`:
```ts
.select(
  "id, class_id, period_slot_id, day, academic_year, slot_type, subject_id, teacher_id, resource_id, notes, custom_label, is_optional_band, " +
  "subject:universal_subjects!tt_slots_subject_id_fkey(id, name), " +
  "teacher:profiles!tt_slots_teacher_id_fkey(id, full_name)",
)
```

`SlotRaw` type (around line 825) — add `custom_label: string | null;` after `notes: string | null;`.

Mapper (around line 840) — insert `custom_label: r.custom_label,` after `notes: null,` (students never see notes, but they DO see the custom label — it's the visible slot label, not a private annotation).

- [ ] **Step 7: Extend `TeacherWeekSlot` + `useTeacherWeekV2` read**

Around line 578, add `custom_label: string | null;` to the `TeacherWeekSlot` interface (place it after `subject_name`).

Around line 610, extend the select string:

```ts
.select(
  "id, day, slot_type, notes, custom_label, class_id, period_slot_id, " +
  "period:tt_period_slots!tt_slots_period_slot_id_fkey(id, label, start_time, end_time, kind), " +
  "class:classes!tt_slots_class_id_fkey(id, name, section), " +
  "subject:universal_subjects!tt_slots_subject_id_fkey(id, name)",
)
```

Extend the local `Row` type (around line 618) — add `custom_label: string | null;` after `notes: string | null;`.

Extend the mapper (around line 632) — add `custom_label: r.custom_label,` after `subject_name`:

```ts
.map((r): TeacherWeekSlot => ({
  id: r.id,
  day: r.day,
  period_label: r.period!.label,
  start_time: r.period!.start_time,
  end_time: r.period!.end_time,
  period_kind: r.period!.kind,
  class_id: r.class!.id,
  class_name: r.class!.name,
  class_section: r.class!.section,
  subject_id: r.subject?.id ?? null,
  subject_name: r.subject?.name ?? null,
  custom_label: r.custom_label,
  slot_type: r.slot_type,
  notes: r.notes,
  isSubstitute: false,
}))
```

- [ ] **Step 8: Typecheck + lint the hook file**

```
npm run typecheck
npx eslint src/hooks/useTimetableV2.ts
```

Both must exit 0. Common failure: forgot `custom_label` on one of the three mappers → the returned literal doesn't satisfy the interface.

- [ ] **Step 9: Commit**

```
git add src/hooks/useTimetableV2.ts
git commit -m "feat(timetable): thread custom_label through slot types + read/write hooks"
```

---

### Task 3: Slot drawer — Other option, custom-label input, clear-on-switch

**Files:**
- Modify: `src/components/timetable-v2/SlotDrawerV2.tsx` — full file, key spots at L46–L57 (constants), L88–L103 (state + reset effect), L127–L146 (submit gates), L153–L175 (handleSave), L216–L232 (slot-type picker), and one new block below the picker for the custom-label input.
- Create: nothing.

**Interfaces:**
- Consumes: `SlotType` union with `'other'` and `SaveTtSlotInput.custom_label: string | null` from Task 2.
- Produces: When the user picks `Other`, an input appears; empty/whitespace label disables Save. On save, `custom_label` = trimmed string when Other, `null` otherwise.

- [ ] **Step 1: Add the `Other` label + import `Input`**

In `src/components/timetable-v2/SlotDrawerV2.tsx`, add the `Input` import near the other UI imports (after `Textarea`):

```ts
import { Input } from "@/components/ui/input";
```

Then update the `SLOT_TYPE_LABEL` map (around line 48):

```ts
const SLOT_TYPE_LABEL: Record<SlotType, string> = {
  theory: "Theory",
  practical: "Practical",
  library: "Library",
  sports: "Sports",
  arts: "Arts",
  assembly: "Assembly",
  free: "Free",
  break: "Break",
  other: "Other",
};
```

- [ ] **Step 2: Add `customLabel` state + reset effect**

Around line 92, add a new `useState` right after `notes`:

```ts
const [customLabel, setCustomLabel] = useState<string>(existingSlot?.custom_label ?? "");
```

Around line 96, extend the reset effect:

```ts
useEffect(() => {
  if (!open) return;
  setSlotType(existingSlot?.slot_type ?? "theory");
  setSubjectId(existingSlot?.subject_id ?? null);
  setTeacherId(existingSlot?.teacher_id ?? null);
  setNotes(existingSlot?.notes ?? "");
  setCustomLabel(existingSlot?.custom_label ?? "");
  setIsOptionalBand(existingSlot?.is_optional_band ?? false);
}, [open, existingSlot]);
```

- [ ] **Step 3: Gate Save on non-empty custom_label when Other**

Around line 142, replace the `canSubmit` computation:

```ts
const isOther = slotType === "other";
const customLabelValid = !isOther || customLabel.trim().length > 0;

const canSubmit = canEdit && !saving && (
  !requiresSubject || subjectId !== null
) && (
  !requiresTeacher || teacherId !== null
) && customLabelValid;
```

- [ ] **Step 4: Persist `custom_label` in `handleSave`**

Around line 153, update `handleSave`:

```ts
async function handleSave() {
  setSaving(true);
  try {
    const otherSelected = !isOptionalBand && slotType === "other";
    await onSave({
      id: existingSlot?.id,
      class_id: classId,
      period_slot_id: periodSlot.id,
      day,
      academic_year: academicYear,
      // A band cell has no single subject/teacher — store it as a 'free'
      // slot flagged is_optional_band so the slot_type CHECK is satisfied.
      slot_type: isOptionalBand ? "free" : slotType,
      subject_id: isOptionalBand || !requiresSubject ? null : subjectId,
      teacher_id: isOptionalBand || !requiresTeacher ? null : teacherId,
      resource_id: existingSlot?.resource_id ?? null,
      notes: notes.trim() ? notes.trim() : null,
      custom_label: otherSelected ? customLabel.trim() : null,
      is_optional_band: isOptionalBand,
    });
    onOpenChange(false);
  } finally {
    setSaving(false);
  }
}
```

- [ ] **Step 5: Clear label when switching away from Other; clear subject/teacher when switching to Other**

Change the picker's `onValueChange` handler at line 220. Replace:

```tsx
<Select value={slotType} onValueChange={(v) => setSlotType(v as SlotType)} disabled={!canEdit}>
```

with:

```tsx
<Select
  value={slotType}
  onValueChange={(v) => {
    const next = v as SlotType;
    setSlotType(next);
    if (next === "other") {
      setSubjectId(null);
      setTeacherId(null);
    } else {
      setCustomLabel("");
    }
  }}
  disabled={!canEdit}
>
```

- [ ] **Step 6: Render the custom-label input when Other is selected**

Immediately AFTER the slot-type `<Select>` block (i.e. after the closing `</div>` of the `Slot type` section around line 232, still inside the `{!isOptionalBand && (<>...</>)}` fragment) — but BEFORE the `{requiresSubject && (...)}` block — insert:

```tsx
{slotType === "other" && (
  <div className="space-y-2">
    <label className="text-sm font-medium">Custom label</label>
    <Input
      value={customLabel}
      onChange={(e) => setCustomLabel(e.target.value.slice(0, 40))}
      disabled={!canEdit}
      maxLength={40}
      placeholder="e.g. Lunch, Football, Yoga"
    />
    <p className="text-xs text-muted-foreground">
      Shown in the cell for teachers and students. Max 40 characters.
    </p>
  </div>
)}
```

Note the `.slice(0, 40)` in `onChange` — belt-and-suspenders against a paste that exceeds `maxLength`.

- [ ] **Step 7: Typecheck + lint**

```
npm run typecheck
npx eslint src/components/timetable-v2/SlotDrawerV2.tsx
```

Both must exit 0.

- [ ] **Step 8: Commit**

```
git add src/components/timetable-v2/SlotDrawerV2.tsx
git commit -m "feat(timetable): 'Other' option in slot drawer with custom-label input"
```

---

### Task 4: Grid — Other tint + custom_label cell rule (also fixes student week)

**Files:**
- Modify: `src/components/timetable-v2/TimetableGridV2.tsx` — `TYPE_TINT` at L60–L69, cell-content JSX at L224–L228, `labelForType` at L258–L269.

**Interfaces:**
- Consumes: `ResolvedSlotV2.custom_label` from Task 2.
- Produces: Grid cells with `slot_type === 'other'` render `custom_label` in a violet tint. `TimetableGridV2` is reused by `StudentWeekPageV2`, so student week gets the fix transitively.

- [ ] **Step 1: Add `other` tint to `TYPE_TINT`**

Around line 60, in `TimetableGridV2.tsx`:

```ts
const TYPE_TINT: Record<string, string> = {
  theory: "bg-teal-50 text-teal-900 hover:bg-teal-100 border-teal-200",
  practical: "bg-amber-50 text-amber-900 hover:bg-amber-100 border-amber-200",
  library: "bg-sky-50 text-sky-900 hover:bg-sky-100 border-sky-200",
  sports: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100 border-emerald-200",
  arts: "bg-pink-50 text-pink-900 hover:bg-pink-100 border-pink-200",
  assembly: "bg-indigo-50 text-indigo-900 hover:bg-indigo-100 border-indigo-200",
  free: "bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200",
  break: "bg-slate-100 text-slate-500 border-slate-200",
  other: "bg-violet-50 text-violet-900 hover:bg-violet-100 border-violet-200",
};
```

- [ ] **Step 2: Branch cell text on `slot_type === 'other'`**

Around line 224, the current expression is:

```tsx
<span className="text-xs font-medium truncate">
  {existing.subject_name ?? labelForType(existing.slot_type)}
</span>
```

Change to:

```tsx
<span className="text-xs font-medium truncate">
  {existing.slot_type === "other"
    ? (existing.custom_label ?? "Other")
    : (existing.subject_name ?? labelForType(existing.slot_type))}
</span>
```

- [ ] **Step 3: Add a defensive fallback in `labelForType`**

Around line 258, extend the switch so `labelForType('other')` returns `'Other'` (should never fire because DB requires the label, but keeps the fallback chain honest):

```ts
function labelForType(t: string): string {
  switch (t) {
    case "library": return "Library";
    case "sports": return "Sports";
    case "arts": return "Arts";
    case "assembly": return "Assembly";
    case "free": return "Free";
    case "break": return "Break";
    case "practical": return "Practical";
    case "other": return "Other";
    default: return t;
  }
}
```

- [ ] **Step 4: Typecheck + lint**

```
npm run typecheck
npx eslint src/components/timetable-v2/TimetableGridV2.tsx
```

Both must exit 0.

- [ ] **Step 5: Commit**

```
git add src/components/timetable-v2/TimetableGridV2.tsx
git commit -m "feat(timetable): render custom_label in grid cells for Other slots"
```

---

### Task 5: Print view + Teacher week card — apply the same rule

**Files:**
- Modify: `src/components/timetable-v2/TimetablePrintViewV2.tsx` — `renderCell()` at L228–L244.
- Modify: `src/pages/teacher/TeacherMyWeekPageV2.tsx` — around L501 where `subjectLabel` is computed.

**Interfaces:**
- Consumes: `ResolvedSlotV2.custom_label` + `TeacherWeekSlot.custom_label` from Task 2.
- Produces: Print output and teacher's My Week card both display `custom_label` when `slot_type === 'other'`.

- [ ] **Step 1: Print view — branch `renderCell` on Other**

In `src/components/timetable-v2/TimetablePrintViewV2.tsx` around line 228, replace `renderCell` with:

```ts
function renderCell(slot: ResolvedSlotV2 | undefined): string {
  if (!slot) return `<span class="empty">N/A</span>`;
  if (slot.slot_type === "other") {
    const label = slot.custom_label ?? "Other";
    return `
      <div class="kind">${escapeHtml(label)}</div>
    `;
  }
  const isAcademic = slot.slot_type === "theory" || slot.slot_type === "practical";
  if (isAcademic) {
    const subj = slot.subject_name ?? "N/A";
    const kind = slot.slot_type === "practical" ? " (Prac.)" : "";
    return `
      <div class="subject">${escapeHtml(subj)}${kind}</div>
      ${slot.teacher_name ? `<div class="teacher">${escapeHtml(slot.teacher_name)}</div>` : ""}
    `;
  }
  const label = capitalize(slot.slot_type);
  return `
    <div class="kind">${escapeHtml(label)}</div>
    ${slot.teacher_name ? `<div class="teacher">${escapeHtml(slot.teacher_name)}</div>` : ""}
  `;
}
```

The Other branch omits the teacher line by design — Other slots have no teacher.

- [ ] **Step 2: Teacher My Week — branch `subjectLabel` on Other**

In `src/pages/teacher/TeacherMyWeekPageV2.tsx` around line 501, replace:

```ts
const subjectLabel = slot.subject_name ?? "Free period";
```

with:

```ts
const subjectLabel =
  slot.slot_type === "other"
    ? (slot.custom_label ?? "Other")
    : (slot.subject_name ?? "Free period");
```

- [ ] **Step 3: Typecheck + lint the two files**

```
npm run typecheck
npx eslint src/components/timetable-v2/TimetablePrintViewV2.tsx src/pages/teacher/TeacherMyWeekPageV2.tsx
```

Both must exit 0.

- [ ] **Step 4: Commit**

```
git add src/components/timetable-v2/TimetablePrintViewV2.tsx src/pages/teacher/TeacherMyWeekPageV2.tsx
git commit -m "feat(timetable): render custom_label in print view and teacher My Week"
```

---

### Task 6: Full verification + manual walkthrough

**Files:** none modified — this is the §5a hard-contract check + a browser sanity pass.

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: green typecheck + lint + build, plus a manually-verified end-to-end flow.

- [ ] **Step 1: Full typecheck**

```
npm run typecheck
```

Expected: exit 0. If it fails, the error is a missed spot from Task 2 (a `ResolvedSlotV2` literal without `custom_label`) or from the types regen — read the error and go back.

- [ ] **Step 2: ESLint on every touched file**

```
npx eslint src/hooks/useTimetableV2.ts src/components/timetable-v2/SlotDrawerV2.tsx src/components/timetable-v2/TimetableGridV2.tsx src/components/timetable-v2/TimetablePrintViewV2.tsx src/pages/teacher/TeacherMyWeekPageV2.tsx
```

Expected: exit 0.

- [ ] **Step 3: Production build**

```
npx vite build
```

Expected: exit 0. Bundle-size warnings (>500 kB) are not failures.

- [ ] **Step 4: Manual browser walkthrough (dev server)**

```
npm run dev
```

Log in as school_admin on a school that has at least one published class timetable. Then:

1. Navigate to Timetable → pick a class → click any empty cell.
2. Slot drawer opens. Slot type dropdown now contains **Other** at the bottom.
3. Pick **Other** → a "Custom label" text field appears; Subject/Teacher blocks disappear.
4. With the label empty, **Save** is disabled.
5. Type `Lunch`; Save enables. Click Save.
6. The cell reads **Lunch** with a violet tint on the admin grid.
7. Reopen the cell — the drawer shows Other + `Lunch` preserved.
8. Switch the type to Assembly, save. Cell reads **Assembly**; the custom_label is dropped in DB (verify with an inspector or SELECT).
9. Switch it back to Other, type `Football`, save. Confirm cell reads **Football**.
10. Log out. Log in as the teacher assigned to that class → **My Week** shows the `Football` slot with label "Football" instead of "Free period".
11. Log in as a student in that class → **My Week** grid cell shows `Football` in violet.
12. Back as admin, click Print → the printed layout shows `Football` in the corresponding cell (no teacher line).
13. Regression: create/edit an existing Theory + Assembly slot; both still render correctly.

If any step fails, drop back to the responsible task and fix — do NOT ship partial success.

- [ ] **Step 5: Final commit (only if you had any drive-by fixes from Step 4)**

If the walkthrough was clean and you have no further edits, skip. Otherwise:

```
git add <files>
git commit -m "fix(timetable): <what you found in walkthrough>"
```

- [ ] **Step 6: Announce completion**

Report to the user:
- Migration applied to prod: `20260725120000_tt_slots_other_type.sql`
- Files modified: 5 (`useTimetableV2.ts`, `SlotDrawerV2.tsx`, `TimetableGridV2.tsx`, `TimetablePrintViewV2.tsx`, `TeacherMyWeekPageV2.tsx`) + regenerated `types.ts`.
- Commits: 5 (one per task 1-5) + optional 6.
- Verification: typecheck ✓, eslint ✓, vite build ✓, manual walkthrough ✓ on {admin, teacher, student} × {grid, week, print}.

---

## Self-review (author's checklist)

**Spec coverage:**
- Schema (CHECK extension + `custom_label` + two guards) — Task 1.
- `SlotType` union — Task 2 Step 1.
- `ResolvedSlotV2` / `TeacherWeekSlot` / `SaveTtSlotInput` — Task 2 Steps 2, 3, 7.
- `useSaveTtSlot` payload — Task 2 Step 4.
- All three select projections — Task 2 Steps 5–7.
- Drawer picker + Input + clear-on-switch + save — Task 3.
- Grid tint + cell rule + `labelForType` — Task 4.
- Print view + teacher week — Task 5.
- Student week — covered transitively by Task 4 (StudentWeekPageV2 renders TimetableGridV2).
- Types regen — Task 1 Step 5.
- §5a verification — Task 6.

**Type consistency:**
- `custom_label: string | null` used identically on `ResolvedSlotV2`, `TeacherWeekSlot`, `SaveTtSlotInput`, and every `SlotRaw` local type.
- `SlotType` union extended once (Task 2 Step 1); consumed as `'other'` in Tasks 3–5 with matching spelling.
- `TYPE_TINT.other` key matches `SlotType` value `'other'`.

**Placeholder scan:** no TBDs, TODOs, "similar to task N", or vague "add error handling" clauses. The migration timestamp `<TIMESTAMP>` in Task 1 is a real convention (implementer stamps at file creation).
