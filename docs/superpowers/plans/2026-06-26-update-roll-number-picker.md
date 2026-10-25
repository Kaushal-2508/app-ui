# Update Roll Number — Class → Section → Students Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Update Roll Number" button to the existing Update Student Details dialog that opens a Class → Section → Students wizard. The admin picks a section, batch-edits roll numbers with client-side duplicate prevention, and saves via the existing `update_student_details` RPC.

**Architecture:** Pure frontend. A new `MobileSheet`-based 3-step wizard component (`UpdateRollNumberSheet`) plus one small TanStack Query hook. The save loop reuses `useUpdateStudentDetails` per row sequentially so the RPC's per-class uniqueness errors stay attributable to a specific row. No DB migration, no edge function, no new dependency.

**Tech Stack:** React 18 + TS, TanStack Query v5, Supabase (PostgREST + the existing `update_student_details` RPC), shadcn/ui primitives, the SALCI shared `MobileSheet` + `EmptyState` + `StatTile`.

Design spec: `docs/superpowers/specs/2026-06-26-update-roll-number-picker-design.md`.

## Global Constraints

- **No test runner exists.** Verification per task = `npm run typecheck` (exit 0) + `npx eslint <touched paths>` (0 errors) + (at the final task) `npx vite build` (exit 0), plus the manual browser smoke named in the task. (CLAUDE.md §5a)
- **Lint is strict:** `@typescript-eslint/no-explicit-any` and `prefer-const` are hard errors. Never `as any` — use a real/inline type or `unknown` + narrow cast. (§5a)
- **Errors:** every `onError` / catch toast goes through `toastError(err, { fallback, context })` from `src/lib/toast.ts`. Never `toast.error(err.message)`. (§19)
- **Auth:** never call `supabase.auth.getUser()` without a JWT — read the user id from `useAuth` / local session. (§23)
- **No `select("*")`** anywhere; explicit columns only. (§23)
- **Every new `useQuery` declares `staleTime: 60_000` minimum.** No `refetchInterval` here. (§23)
- **Design:** colors / shadows / radii via tokens only (`surface-card`, `frosted-shadow`, `rounded-card`, `text-ink-900` / `text-ink-600`, brand tokens). Dark mode + 375px safe. (design-system skill §3–4)
- **Sheet primitive:** always `MobileSheet` from `@/components/shared/sheets` (never raw shadcn `Dialog` or `Sheet`). The bulk dialog is allowed to stay a `Dialog` because it predates Phase 7 — we're not refactoring it. (design-system skill §4)
- **Branch:** all work on `feat/update-roll-number-picker` (create off `main`). Commit after each task. Match the project's existing commit-trailer convention if any (the repo currently uses no trailer on its own commits — match that).

---

## File Structure

- **NEW** `src/hooks/useSectionStudentsForRoll.ts` — TanStack Query hook fetching `{ id, full_name, roll_number }` for one `class_id` (section).
- **NEW** `src/components/school/UpdateRollNumberSheet.tsx` — the 3-step `MobileSheet` wizard. Single component, internal `step` state drives which sub-view (`<ClassStep>`, `<SectionStep>`, `<StudentsStep>`) renders.
- **MOD** `src/components/school/BulkUpdateStudentsDialog.tsx` — accept an optional `onOpenRollNumberPicker?: () => void` prop; render a new "Update Roll Number" button above the existing "Download Template" button when the prop is provided; clicking it calls the prop and closes the dialog.
- **MOD** `src/pages/school/SchoolStudentsPage.tsx` — new `rollSheetOpen` state; render `<UpdateRollNumberSheet>` next to the existing dialogs; pass `onOpenRollNumberPicker={() => setRollSheetOpen(true)}` to `<BulkUpdateStudentsDialog>`.

---

## Task 1: Sheet shell + Step 1 class picker + entry-point wiring

End state: opening the Students tab, clicking the kebab → Update Details → **Update Roll Number** opens a `MobileSheet` showing a card grid of class_groups for the institution. Picking a card sets state; nothing further happens yet.

**Files:**
- Create: `src/components/school/UpdateRollNumberSheet.tsx`
- Modify: `src/components/school/BulkUpdateStudentsDialog.tsx` (button row above "Download Template" + new prop)
- Modify: `src/pages/school/SchoolStudentsPage.tsx` (state + mount + callback prop)

**Interfaces:**
- Produces: `UpdateRollNumberSheet` component with props `{ open: boolean; onOpenChange: (open: boolean) => void; institutionId: string | null; }`. Internal state `step: "class" | "section" | "students"`, `classGroupId: string | null`, `classId: string | null`.
- Produces: `BulkUpdateStudentsDialog` accepts a new optional prop `onOpenRollNumberPicker?: () => void`. The dialog's existing props stay backwards-compatible.

- [ ] **Step 1: Create `feat/update-roll-number-picker` branch from `main`**

Run:
```bash
git checkout main && git pull --ff-only && git checkout -b feat/update-roll-number-picker
```
Expected: clean checkout, new branch.

- [ ] **Step 2: Read the existing files you're modifying**

Read these so you match local conventions:
- `src/components/shared/sheets/MobileSheet.tsx` (props: `open`, `onOpenChange`, `title`, `subtitle?`, `icon?`, `primaryAction?`, `secondaryAction?`, `children`, `className?`).
- `src/components/school/BulkUpdateStudentsDialog.tsx` — find the "Download Template" button so you know where to insert above it.
- `src/pages/school/SchoolStudentsPage.tsx` — find where `<BulkUpdateStudentsDialog>` is mounted and the existing sibling state pattern for other dialogs.
- `src/hooks/useClassGroups.ts` — confirm `useInstitutionClassGroups(institutionId)` and the shape of `ClassGroupWithSections` (`id`, `name`, `section_count`, plus whatever else it exposes).

- [ ] **Step 3: Write `src/components/school/UpdateRollNumberSheet.tsx` — shell + Step 1 only**

```tsx
import * as React from "react";
import { GraduationCap, Users } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useInstitutionClassGroups } from "@/hooks/useClassGroups";

interface UpdateRollNumberSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string | null;
}

type Step = "class" | "section" | "students";

export function UpdateRollNumberSheet({
  open,
  onOpenChange,
  institutionId,
}: UpdateRollNumberSheetProps) {
  const [step, setStep] = React.useState<Step>("class");
  const [classGroupId, setClassGroupId] = React.useState<string | null>(null);
  const [classGroupName, setClassGroupName] = React.useState<string>("");
  const [classId, setClassId] = React.useState<string | null>(null);
  const [classLabel, setClassLabel] = React.useState<string>("");

  // Reset on close so a fresh open always lands on Step 1.
  React.useEffect(() => {
    if (!open) {
      setStep("class");
      setClassGroupId(null);
      setClassGroupName("");
      setClassId(null);
      setClassLabel("");
    }
  }, [open]);

  const subtitle =
    step === "class"
      ? "Pick a class to start"
      : step === "section"
        ? classGroupName
        : `${classGroupName}  ›  ${classLabel}`;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Update Roll Number"
      subtitle={subtitle}
      icon={<GraduationCap className="h-5 w-5 text-brand-primary" />}
    >
      {step === "class" && (
        <ClassStep
          institutionId={institutionId}
          onPick={(id, name) => {
            setClassGroupId(id);
            setClassGroupName(name);
            setStep("section");
          }}
        />
      )}
      {step === "section" && classGroupId && (
        <SectionStepPlaceholder />
      )}
      {step === "students" && classId && (
        <StudentsStepPlaceholder />
      )}
    </MobileSheet>
  );
}

interface ClassStepProps {
  institutionId: string | null;
  onPick: (classGroupId: string, classGroupName: string) => void;
}

function ClassStep({ institutionId, onPick }: ClassStepProps) {
  const { data, isLoading, isError } = useInstitutionClassGroups(institutionId);

  if (isLoading) {
    return <div className="p-6 text-sm text-ink-600">Loading classes…</div>;
  }
  if (isError) {
    return (
      <EmptyState
        icon={Users}
        title="Couldn't load classes"
        description="Please close this and try again."
      />
    );
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No classes set up yet"
        description="Use Manage Classes to add a class before assigning roll numbers."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((cg) => (
        <button
          key={cg.id}
          type="button"
          onClick={() => onPick(cg.id, cg.name)}
          className="surface-card frosted-shadow rounded-card p-4 text-left transition hover:-translate-y-0.5 hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          <p className="eyebrow">Class</p>
          <p className="mt-1 text-lg font-semibold text-ink-900">{cg.name}</p>
          <p className="mt-2 text-sm text-ink-600">
            {cg.section_count ?? 0} section
            {(cg.section_count ?? 0) === 1 ? "" : "s"}
          </p>
        </button>
      ))}
    </div>
  );
}

function SectionStepPlaceholder() {
  return <div className="p-6 text-sm text-ink-600">Section picker — wired in Task 2.</div>;
}

function StudentsStepPlaceholder() {
  return <div className="p-6 text-sm text-ink-600">Students table — wired in Task 3.</div>;
}
```

> Note on `EmptyState`: if the actual import path / icon prop name differs in your repo, adjust to match `src/components/shared/surfaces/EmptyState.tsx`. Same for `useInstitutionClassGroups`'s exact field name (`section_count` vs another) — match the file you read in Step 2 and tweak the JSX accordingly.

- [ ] **Step 4: Modify `BulkUpdateStudentsDialog.tsx` — accept the new prop + render the button**

In the props interface, add (preserving existing props):
```ts
interface BulkUpdateStudentsDialogProps {
  // ...existing props...
  onOpenRollNumberPicker?: () => void;
}
```

Destructure in the component signature: `onOpenRollNumberPicker`.

Locate the JSX node containing the "Download Template" button (search for `Download Template` in the file). Immediately **above** that button's container, insert:
```tsx
{onOpenRollNumberPicker && (
  <button
    type="button"
    onClick={() => {
      onOpenChange(false);
      onOpenRollNumberPicker();
    }}
    className="flex w-full items-center justify-between rounded-lg border border-brand-primary/30 bg-brand-primary/5 px-4 py-3 text-left transition hover:bg-brand-primary/10"
  >
    <span>
      <span className="block text-sm font-semibold text-brand-primary">
        Update Roll Number
      </span>
      <span className="block text-xs text-ink-600">
        Pick a class &rsaquo; section and edit roll numbers in a list
      </span>
    </span>
    <span aria-hidden className="text-brand-primary">&rsaquo;</span>
  </button>
)}
```

If the dialog uses a shadcn `Button` for the Download Template row, prefer to mirror that variant for visual consistency — adapt the snippet to use the same `<Button>` component the file already imports. The exact prop the dialog uses to call its own close (`onOpenChange(false)` vs `setOpen(false)`) — match what's already there.

- [ ] **Step 5: Modify `SchoolStudentsPage.tsx` — state + mount + callback**

Near the other sibling-state declarations (look for existing `useState` for the bulk-update or promote dialogs), add:
```tsx
const [rollSheetOpen, setRollSheetOpen] = React.useState(false);
```

In the JSX (next to the existing `<BulkUpdateStudentsDialog>` render), add:
```tsx
<UpdateRollNumberSheet
  open={rollSheetOpen}
  onOpenChange={setRollSheetOpen}
  institutionId={roleInfo?.institutionId ?? null}
/>
```
and import:
```tsx
import { UpdateRollNumberSheet } from "@/components/school/UpdateRollNumberSheet";
```

On the existing `<BulkUpdateStudentsDialog>` render, pass:
```tsx
onOpenRollNumberPicker={() => setRollSheetOpen(true)}
```

The variable name for the auth/role context is whatever this page already uses (check the existing students query — it reads `roleInfo?.institutionId`). Don't rename it; just reuse.

- [ ] **Step 6: Verify**

Run:
```bash
npm run typecheck
npx eslint src/components/school/UpdateRollNumberSheet.tsx src/components/school/BulkUpdateStudentsDialog.tsx src/pages/school/SchoolStudentsPage.tsx
```
Expected: typecheck exits 0 with no new errors; eslint reports 0 errors on the three paths.

- [ ] **Step 7: Browser smoke**

Run `npm run dev`. Log in as a school_admin. Navigate to `/school/users` → Students tab → click the kebab → "Update Details". The bulk dialog should show a new **Update Roll Number** button above Download Template. Click it. The bulk dialog should close and the sheet should slide up showing the class card grid. Pick a class → the title's subtitle should update to the class name and the placeholder text "Section picker — wired in Task 2." should appear. Toggle dark mode mid-flow: cards and text should flip cleanly. At 375px width: cards stack to a single column, no horizontal scroll.

- [ ] **Step 8: Commit**

```bash
git add src/components/school/UpdateRollNumberSheet.tsx src/components/school/BulkUpdateStudentsDialog.tsx src/pages/school/SchoolStudentsPage.tsx
git commit -m "feat(students): scaffold UpdateRollNumberSheet with class picker + dialog entry"
```

---

## Task 2: Step 2 section picker + breadcrumb back-nav

End state: picking a class advances to a section card grid for that class_group. A clickable breadcrumb above the grid lets the admin pop back to Step 1. The Students-step placeholder still shows when a section is picked.

**Files:**
- Modify: `src/components/school/UpdateRollNumberSheet.tsx`

**Interfaces:**
- Consumes: `useClassGroupSections(classGroupId: string)` from `src/hooks/useClassGroups.ts` — returns `{ data: { id, name, section, class_group_id, ... }[] }`. Section label = `section ?? name`.
- Produces: `<SectionStep>` sub-component replacing the Task 1 placeholder. `<Breadcrumb>` sub-component reused on Steps 2 and 3.

- [ ] **Step 1: Add the Breadcrumb sub-component**

At the bottom of `UpdateRollNumberSheet.tsx`, add:
```tsx
interface BreadcrumbProps {
  items: { label: string; onClick?: () => void }[];
}

function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1 px-4 pt-4 text-sm text-ink-600"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${idx}`}>
            {item.onClick && !isLast ? (
              <button
                type="button"
                onClick={item.onClick}
                className="rounded px-1 py-0.5 font-medium text-brand-primary hover:bg-brand-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                {item.label}
              </button>
            ) : (
              <span className={isLast ? "font-semibold text-ink-900" : ""}>
                {item.label}
              </span>
            )}
            {!isLast && <span className="text-ink-400" aria-hidden>›</span>}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Replace `SectionStepPlaceholder` with the real `SectionStep`**

Add the new sub-component (uses `useClassGroupSections`):
```tsx
import { useClassGroupSections } from "@/hooks/useClassGroups";
// ... (add this import near the top alongside useInstitutionClassGroups)

interface SectionStepProps {
  classGroupId: string;
  classGroupName: string;
  onBack: () => void;
  onPick: (classId: string, label: string) => void;
}

function SectionStep({ classGroupId, classGroupName, onBack, onPick }: SectionStepProps) {
  const { data, isLoading, isError } = useClassGroupSections(classGroupId);

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Classes", onClick: onBack },
          { label: classGroupName },
        ]}
      />
      {isLoading && (
        <div className="p-6 text-sm text-ink-600">Loading sections…</div>
      )}
      {isError && (
        <EmptyState
          icon={Users}
          title="Couldn't load sections"
          description="Please go back and try again."
        />
      )}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <EmptyState
          icon={Users}
          title="No sections in this class"
          description="Add a section under Manage Classes first."
        />
      )}
      {!isLoading && !isError && data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((sec) => {
            const label = sec.section ? `Section ${sec.section}` : sec.name;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => onPick(sec.id, label)}
                className="surface-card frosted-shadow rounded-card p-4 text-left transition hover:-translate-y-0.5 hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <p className="eyebrow">{classGroupName}</p>
                <p className="mt-1 text-lg font-semibold text-ink-900">{label}</p>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Wire `SectionStep` into the sheet's render switch**

In the main `UpdateRollNumberSheet` return, replace the `<SectionStepPlaceholder />` line with:
```tsx
{step === "section" && classGroupId && (
  <SectionStep
    classGroupId={classGroupId}
    classGroupName={classGroupName}
    onBack={() => {
      setClassGroupId(null);
      setClassGroupName("");
      setStep("class");
    }}
    onPick={(id, label) => {
      setClassId(id);
      setClassLabel(label);
      setStep("students");
    }}
  />
)}
```

Delete the now-unused `SectionStepPlaceholder` function.

- [ ] **Step 4: Verify**

Run:
```bash
npm run typecheck
npx eslint src/components/school/UpdateRollNumberSheet.tsx
```
Expected: both clean.

- [ ] **Step 5: Browser smoke**

Open the sheet (Update Details → Update Roll Number). Click a class → Step 2 grid appears with sections. Click "Classes" in the breadcrumb → returns to Step 1 with the previous class deselected. Click a class → click a section → placeholder "Students table — wired in Task 3." appears. At 375px: breadcrumb wraps without overflow; cards stack.

- [ ] **Step 6: Commit**

```bash
git add src/components/school/UpdateRollNumberSheet.tsx
git commit -m "feat(students): section step + back-nav breadcrumb in roll number sheet"
```

---

## Task 3: `useSectionStudentsForRoll` hook + Step 3 students table with inline editing + duplicate detection (no save yet)

End state: picking a section advances to a table of that section's students. Each row shows the student name and an editable roll-number input. Duplicate (non-empty) values across visible rows light up red and a banner explains the conflict. The sticky footer renders a Cancel + Save Changes (Save disabled while duplicates exist OR no edits made). Clicking Save Changes does nothing yet (Task 4).

**Files:**
- Create: `src/hooks/useSectionStudentsForRoll.ts`
- Modify: `src/components/school/UpdateRollNumberSheet.tsx`

**Interfaces:**
- Produces: `useSectionStudentsForRoll(classId: string | null)` returns a `UseQueryResult` whose `data` is `Array<{ id: string; full_name: string; roll_number: string | null }>` sorted by `(roll_number asc nulls last, full_name)`. Query key `["section-students-for-roll", classId]`. Disabled when `classId` is null.
- Produces: `<StudentsStep>` sub-component that consumes lifted state via props: `drafts`, `originals`, `setDrafts`, `setOriginals`, `duplicates`, `changedCount`. The state lives on the parent `UpdateRollNumberSheet` (added in this task's Step 2) so `MobileSheet`'s `primaryAction` / `secondaryAction` can read and gate from the same source.

- [ ] **Step 1: Create the hook**

`src/hooks/useSectionStudentsForRoll.ts`:
```ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export interface SectionStudentForRoll {
  id: string;
  full_name: string;
  roll_number: string | null;
}

interface ClassAssignmentRow {
  user_id: string;
  profiles:
    | { id: string; full_name: string; roll_number: string | null }
    | { id: string; full_name: string; roll_number: string | null }[]
    | null;
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function compareRoll(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const an = Number(a);
  const bn = Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function useSectionStudentsForRoll(classId: string | null) {
  return useQuery({
    queryKey: ["section-students-for-roll", classId],
    enabled: !!classId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SectionStudentForRoll[]> => {
      const { data, error } = await supabase
        .from("class_assignments")
        .select(
          "user_id, profiles!class_assignments_user_id_fkey(id, full_name, roll_number)"
        )
        .eq("class_id", classId as string)
        .eq("role", "student");
      if (error) throw error;

      const rows = (data ?? []) as ClassAssignmentRow[];
      const students: SectionStudentForRoll[] = [];
      for (const row of rows) {
        const p = pickOne(row.profiles);
        if (!p) continue;
        students.push({
          id: p.id,
          full_name: p.full_name,
          roll_number: p.roll_number,
        });
      }
      students.sort((a, b) => {
        const r = compareRoll(a.roll_number, b.roll_number);
        if (r !== 0) return r;
        return a.full_name.localeCompare(b.full_name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
      return students;
    },
  });
}
```

> Type note on the `profiles` join: PostgREST sometimes returns the foreign row as `T | T[]` depending on the cardinality the parser infers. The inline `ClassAssignmentRow` + `pickOne` is the project's standard escape hatch — see CLAUDE.md §5a. Do not use `as any`.

- [ ] **Step 2: Lift drafts/originals state to `UpdateRollNumberSheet` (parent) and wire the sticky footer (stub Save handler)**

`MobileSheet`'s `primaryAction` and `secondaryAction` live on the parent JSX, so the editable state must live on the parent too. Add at the top of `UpdateRollNumberSheet`:

```tsx
const [drafts, setDrafts] = React.useState<Record<string, string>>({});
const [originals, setOriginals] = React.useState<Record<string, string>>({});

const duplicates = React.useMemo(() => {
  const groups = new Map<string, string[]>();
  for (const [id, raw] of Object.entries(drafts)) {
    const v = raw.trim();
    if (!v) continue;
    const arr = groups.get(v) ?? [];
    arr.push(id);
    groups.set(v, arr);
  }
  const dupIds = new Set<string>();
  const dupValues: string[] = [];
  for (const [v, ids] of groups) {
    if (ids.length >= 2) {
      dupValues.push(v);
      for (const id of ids) dupIds.add(id);
    }
  }
  return { dupIds, dupValues };
}, [drafts]);

const changedIds = React.useMemo(() => {
  const out: string[] = [];
  for (const [id, raw] of Object.entries(drafts)) {
    const orig = originals[id] ?? "";
    if (raw.trim() !== orig.trim()) out.push(id);
  }
  return out;
}, [drafts, originals]);

const saveDisabled = duplicates.dupValues.length > 0 || changedIds.length === 0;

// Stub — replaced by the real handler in Task 4.
const saveAll = React.useCallback(() => {
  // eslint-disable-next-line no-console
  console.log("[UpdateRollNumberSheet] save stub — wired in Task 4", { changedIds, drafts });
}, [changedIds, drafts]);

// Mark the body as dirty so the SW update toast doesn't auto-reload mid-edit.
React.useEffect(() => {
  const body = document.body;
  if (changedIds.length > 0) body.setAttribute("data-dirty", "true");
  else body.removeAttribute("data-dirty");
  return () => body.removeAttribute("data-dirty");
}, [changedIds.length]);
```

> The `eslint-disable-next-line no-console` on the stub is fine — Task 4 deletes the entire stub so the disable directive is removed at the same time.

Extend the existing close-reset `useEffect` to also clear `drafts` + `originals`:
```tsx
React.useEffect(() => {
  if (!open) {
    setStep("class");
    setClassGroupId(null);
    setClassGroupName("");
    setClassId(null);
    setClassLabel("");
    setDrafts({});
    setOriginals({});
  }
}, [open]);
```

Add `primaryAction` and `secondaryAction` props to `<MobileSheet>` (gated on Step 3):
```tsx
<MobileSheet
  open={open}
  onOpenChange={(next) => {
    if (!next && changedIds.length > 0) {
      const confirmed = window.confirm(
        "You have unsaved roll number changes. Discard and close?"
      );
      if (!confirmed) return;
    }
    onOpenChange(next);
  }}
  title="Update Roll Number"
  subtitle={subtitle}
  icon={<GraduationCap className="h-5 w-5 text-brand-primary" />}
  primaryAction={
    step === "students"
      ? { label: "Save Changes", onClick: saveAll, disabled: saveDisabled }
      : undefined
  }
  secondaryAction={
    step === "students"
      ? {
          label: "Close",
          onClick: () => {
            if (
              changedIds.length === 0 ||
              window.confirm(
                "You have unsaved roll number changes. Discard and close?"
              )
            ) {
              onOpenChange(false);
            }
          },
        }
      : undefined
  }
>
  {/* existing step switch */}
</MobileSheet>
```

- [ ] **Step 3: Add `StudentsStep` to `UpdateRollNumberSheet.tsx`**

Add the imports:
```tsx
import { useSectionStudentsForRoll, type SectionStudentForRoll } from "@/hooks/useSectionStudentsForRoll";
import { Input } from "@/components/ui/input";
import { AlertTriangle } from "lucide-react";
```

Add the sub-component (it receives lifted state via props):
```tsx
interface StudentsStepProps {
  classId: string;
  classGroupName: string;
  classLabel: string;
  drafts: Record<string, string>;
  originals: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setOriginals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  duplicates: { dupIds: Set<string>; dupValues: string[] };
  changedCount: number;
  onBack: () => void;
  onBackToClasses: () => void;
}

function StudentsStep({
  classId,
  classGroupName,
  classLabel,
  drafts,
  originals: _originals,
  setDrafts,
  setOriginals,
  duplicates,
  changedCount,
  onBack,
  onBackToClasses,
}: StudentsStepProps) {
  const { data, isLoading, isError } = useSectionStudentsForRoll(classId);

  // Seed both drafts + originals from the section's data when it lands.
  React.useEffect(() => {
    if (!data) return;
    setOriginals((prev) => {
      const next = { ...prev };
      for (const s of data) if (!(s.id in next)) next[s.id] = s.roll_number ?? "";
      return next;
    });
    setDrafts((prev) => {
      const next = { ...prev };
      for (const s of data) if (!(s.id in next)) next[s.id] = s.roll_number ?? "";
      return next;
    });
  }, [data, setOriginals, setDrafts]);

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Classes", onClick: onBackToClasses },
          { label: classGroupName, onClick: onBack },
          { label: classLabel },
        ]}
      />

      {duplicates.dupValues.length > 0 && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Duplicate roll numbers</p>
            <p>
              Multiple students share roll
              {duplicates.dupValues.length === 1 ? " number " : " numbers "}
              {duplicates.dupValues.join(", ")}. Resolve before saving.
            </p>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="p-6 text-sm text-ink-600">Loading students…</div>
      )}
      {isError && (
        <EmptyState
          icon={Users}
          title="Couldn't load students"
          description="Please go back and try again."
        />
      )}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <EmptyState
          icon={Users}
          title="No students in this section"
          description="Assign students to this section first."
        />
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <div className="p-4">
          <ul className="surface-card frosted-shadow rounded-card divide-y divide-surface-stroke">
            {data.map((s: SectionStudentForRoll) => {
              const draft = drafts[s.id] ?? "";
              const isDup = duplicates.dupIds.has(s.id);
              return (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm font-medium text-ink-900 sm:flex-1">
                    {s.full_name}
                  </span>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={draft}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))
                    }
                    aria-label={`Roll number for ${s.full_name}`}
                    aria-invalid={isDup}
                    className={
                      "w-full sm:w-32 " +
                      (isDup ? "ring-2 ring-red-500 focus-visible:ring-red-500" : "")
                    }
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            {changedCount === 0
              ? "No changes yet."
              : `${changedCount} change${changedCount === 1 ? "" : "s"} pending.`}
          </p>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Wire `StudentsStep` into the render switch (save handler is the stub from Step 2)**

Replace the `<StudentsStepPlaceholder />` line with:
```tsx
{step === "students" && classId && (
  <StudentsStep
    classId={classId}
    classGroupName={classGroupName}
    classLabel={classLabel}
    drafts={drafts}
    originals={originals}
    setDrafts={setDrafts}
    setOriginals={setOriginals}
    duplicates={duplicates}
    changedCount={changedIds.length}
    onBack={() => {
      setClassId(null);
      setClassLabel("");
      setStep("section");
    }}
    onBackToClasses={() => {
      setClassGroupId(null);
      setClassGroupName("");
      setClassId(null);
      setClassLabel("");
      setStep("class");
    }}
  />
)}
```

Delete the now-unused `StudentsStepPlaceholder` function.

- [ ] **Step 5: Verify**

Run:
```bash
npm run typecheck
npx eslint src/hooks/useSectionStudentsForRoll.ts src/components/school/UpdateRollNumberSheet.tsx
```
Expected: both clean.

- [ ] **Step 6: Browser smoke**

Open the sheet → pick Class N → pick Section A. The students table renders sorted by roll number. Edit a roll number — the "X change(s) pending" counter updates. The footer now shows **Close** + **Save Changes** (Save disabled because we're still on the stub handler — clicking it should log to the console only, see Step 2). Set two students' roll numbers to the same value — both inputs get a red ring and the warning banner appears with the conflicting value. Save Changes stays disabled with the duplicate. Clear one — banner and rings clear; Save Changes enables. Use the breadcrumb to go back to Step 2 → state resets for Step 3. Close the sheet while there's a pending change → confirm prompt appears. At 375px: each row stacks (name above, input below).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSectionStudentsForRoll.ts src/components/school/UpdateRollNumberSheet.tsx
git commit -m "feat(students): editable roll number table with duplicate detection"
```

---

## Task 4: Save batch + cache invalidation + unsaved-changes guard + final verification

End state: clicking **Save Changes** runs the changed rows through `useUpdateStudentDetails` sequentially. Each row turns green on success or red with an inline message on failure. Cache invalidates. The Cancel button (and breadcrumb back nav + sheet close) prompts a confirmation if there are unsaved edits. Full production-clean: typecheck, eslint, build.

**Files:**
- Modify: `src/components/school/UpdateRollNumberSheet.tsx`

**Interfaces:**
- Consumes: `useUpdateStudentDetails()` from `src/hooks/useStudentDetails.ts` (call signature: `mutateAsync({ studentId, fullName, rollNumber, admissionNumber, phone, dateOfBirth, guardianName, guardianPhone, guardianEmail })` — **verify the exact field names in `src/hooks/useStudentDetails.ts` and the underlying RPC parameter list at `supabase/migrations/20260620120000_update_student_details_rpc.sql:13-23` before writing the save loop**).
- Produces: a save handler `saveAll()` that resolves once every changed row has either succeeded or failed.

- [ ] **Step 1: Read the existing hook to nail the call signature**

Open `src/hooks/useStudentDetails.ts`. Confirm the exact field names the mutation expects (camelCase TS vs snake_case RPC). Confirm where it reads its 9 inputs. If it expects fewer fields (e.g. only the ones the StudentDetailsCard surfaces — not dob/guardian_*), you must either:
- (a) pass through ALL existing values (preferred — matches the spec's "fetch existing details once, pass through unchanged") by extending the hook's input type, or
- (b) call the RPC directly (`supabase.rpc("update_student_details", { _student, _full_name, _roll_number, _admission_number, _phone, _date_of_birth, _guardian_name, _guardian_phone, _guardian_email })`).

If the hook already passes through all 9 fields, use it. If it doesn't, prefer (b) — direct RPC call — to avoid widening the hook for an unrelated caller.

- [ ] **Step 2: Add a helper that loads all current details for the section's students once**

Inside `UpdateRollNumberSheet.tsx` (or as a sibling helper in `src/hooks/useSectionStudentsForRoll.ts` — your judgment), add a function that, given an array of student ids, fetches their current `{ full_name, admission_number, phone }` from `profiles` AND `{ date_of_birth, guardian_name, guardian_phone, guardian_email }` from `student_personal_details` (LEFT JOIN — not every student has a row there). Return a `Map<studentId, Existing>` so the save loop can look up unchanged values without re-reading per student.

```ts
interface ExistingStudentDetails {
  full_name: string;
  admission_number: string | null;
  phone: string | null;
  date_of_birth: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
}

async function loadExistingDetails(
  studentIds: string[]
): Promise<Map<string, ExistingStudentDetails>> {
  if (studentIds.length === 0) return new Map();

  const [{ data: profiles, error: pErr }, { data: details, error: dErr }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, admission_number, phone")
        .in("id", studentIds),
      supabase
        .from("student_personal_details")
        .select(
          "profile_id, date_of_birth, guardian_name, guardian_phone, guardian_email"
        )
        .in("profile_id", studentIds),
    ]);

  if (pErr) throw pErr;
  if (dErr) throw dErr;

  const detailsById = new Map<string, {
    date_of_birth: string | null;
    guardian_name: string | null;
    guardian_phone: string | null;
    guardian_email: string | null;
  }>();
  for (const d of details ?? []) {
    detailsById.set(d.profile_id, {
      date_of_birth: d.date_of_birth ?? null,
      guardian_name: d.guardian_name ?? null,
      guardian_phone: d.guardian_phone ?? null,
      guardian_email: d.guardian_email ?? null,
    });
  }

  const out = new Map<string, ExistingStudentDetails>();
  for (const p of profiles ?? []) {
    const d = detailsById.get(p.id);
    out.set(p.id, {
      full_name: p.full_name,
      admission_number: p.admission_number ?? null,
      phone: p.phone ?? null,
      date_of_birth: d?.date_of_birth ?? null,
      guardian_name: d?.guardian_name ?? null,
      guardian_phone: d?.guardian_phone ?? null,
      guardian_email: d?.guardian_email ?? null,
    });
  }
  return out;
}
```

Import `supabase` and `toastError` at the top:
```tsx
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
```

- [ ] **Step 3: Add row-status state (new) + replace the stub `saveAll` with the real handler**

Task 3 already lifted `drafts` / `originals` / `duplicates` / `changedIds` to the parent. Now add the per-row status state (new) and replace the stub:

```tsx
const [rowStatus, setRowStatus] = React.useState<
  Record<string, "idle" | "saving" | "saved" | "error">
>({});
const [rowError, setRowError] = React.useState<Record<string, string>>({});
const [saving, setSaving] = React.useState(false);
const queryClient = useQueryClient();
```

Replace the existing stub `saveAll` (the one Task 3 step 2 created with the `console.log`) and the `saveDisabled` from Task 3 with the saving-aware versions:

```tsx
const saveDisabled =
  saving || duplicates.dupValues.length > 0 || changedIds.length === 0;

const saveAll = React.useCallback(async () => {
  if (saveDisabled) return;
  setSaving(true);

  let existing: Map<string, ExistingStudentDetails>;
  try {
    existing = await loadExistingDetails(changedIds);
  } catch (err) {
    toastError(err, {
      fallback: "Couldn't load current student details. Try again.",
      context: "updateRollNumber.loadExisting",
    });
    setSaving(false);
    return;
  }

  let okCount = 0;
  let failCount = 0;

  for (const id of changedIds) {
    setRowStatus((prev) => ({ ...prev, [id]: "saving" }));
    setRowError((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    const e = existing.get(id);
    if (!e) {
      setRowStatus((prev) => ({ ...prev, [id]: "error" }));
      setRowError((prev) => ({ ...prev, [id]: "Student record not found." }));
      failCount++;
      continue;
    }

    const newRoll = drafts[id].trim();
    try {
      const { error } = await supabase.rpc("update_student_details", {
        _student: id,
        _full_name: e.full_name,
        _roll_number: newRoll === "" ? null : newRoll,
        _admission_number: e.admission_number,
        _phone: e.phone,
        _date_of_birth: e.date_of_birth,
        _guardian_name: e.guardian_name,
        _guardian_phone: e.guardian_phone,
        _guardian_email: e.guardian_email,
      });
      if (error) throw error;
      setRowStatus((prev) => ({ ...prev, [id]: "saved" }));
      setOriginals((prev) => ({ ...prev, [id]: newRoll }));
      okCount++;
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't save roll number.";
      setRowStatus((prev) => ({ ...prev, [id]: "error" }));
      setRowError((prev) => ({ ...prev, [id]: message }));
      failCount++;
    }
  }

  // Invalidate caches once, after the whole batch.
  queryClient.invalidateQueries({ queryKey: ["school-students"] });
  if (classId) {
    queryClient.invalidateQueries({
      queryKey: ["section-students-for-roll", classId],
    });
  }
  for (const id of changedIds) {
    queryClient.invalidateQueries({ queryKey: ["user-details", id] });
  }

  setSaving(false);

  if (failCount === 0) {
    toast.success(`Updated ${okCount} student${okCount === 1 ? "" : "s"}.`);
  } else if (okCount === 0) {
    toast.error(
      `All ${failCount} update${failCount === 1 ? "" : "s"} failed. See per-row messages.`
    );
  } else {
    toast.warning(
      `Saved ${okCount} of ${okCount + failCount}. Fix the ${failCount} red row${failCount === 1 ? "" : "s"} and retry.`
    );
  }
}, [saveDisabled, changedIds, drafts, classId, queryClient]);
```

Delete the `// eslint-disable-next-line no-console` line and the stubbed `saveAll` from Task 3 — they are replaced wholesale by the block above.

The Task 3 `MobileSheet` JSX already wires `primaryAction.onClick` to `saveAll` and `primaryAction.disabled` to `saveDisabled`. Update the `primaryAction.label` to reflect the saving state and add a `loading` flag (matching `MobileSheetAction`'s shape from `MobileSheet.tsx`):

```tsx
primaryAction={
  step === "students"
    ? {
        label: saving ? "Saving…" : "Save Changes",
        onClick: saveAll,
        disabled: saveDisabled,
        loading: saving,
      }
    : undefined
}
```

Also gate the `secondaryAction.disabled` on `saving` so the admin can't close mid-batch:
```tsx
secondaryAction={
  step === "students"
    ? {
        label: "Close",
        onClick: () => {
          if (
            changedIds.length === 0 ||
            window.confirm("You have unsaved roll number changes. Discard and close?")
          ) {
            onOpenChange(false);
          }
        },
        disabled: saving,
      }
    : undefined
}
```

- [ ] **Step 4: Update `StudentsStep` to render per-row status and clear status on re-edit**

Extend `StudentsStep`'s props:
```tsx
interface StudentsStepProps {
  classId: string;
  classGroupName: string;
  classLabel: string;
  drafts: Record<string, string>;
  originals: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setOriginals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  duplicates: { dupIds: Set<string>; dupValues: string[] };
  changedCount: number;
  // NEW in Task 4:
  rowStatus: Record<string, "idle" | "saving" | "saved" | "error">;
  rowError: Record<string, string>;
  setRowStatus: React.Dispatch<
    React.SetStateAction<Record<string, "idle" | "saving" | "saved" | "error">>
  >;
  setRowError: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onBack: () => void;
  onBackToClasses: () => void;
}
```

Inside `StudentsStep`, replace the existing inline `onChange` with a handler that also clears the row's saved/error status:
```tsx
const handleDraftChange = (id: string, value: string) => {
  setDrafts((prev) => ({ ...prev, [id]: value }));
  setRowStatus((prev) => {
    if (!(id in prev)) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  });
  setRowError((prev) => {
    if (!(id in prev)) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  });
};
```

Update each `<li>` row to show status:
```tsx
{data.map((s: SectionStudentForRoll) => {
  const draft = drafts[s.id] ?? "";
  const isDup = duplicates.dupIds.has(s.id);
  const status = rowStatus[s.id] ?? "idle";
  const err = rowError[s.id];
  const ringClass =
    status === "saved"
      ? "ring-2 ring-emerald-500 focus-visible:ring-emerald-500"
      : status === "error" || isDup
        ? "ring-2 ring-red-500 focus-visible:ring-red-500"
        : "";
  return (
    <li
      key={s.id}
      className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex-1">
        <span className="text-sm font-medium text-ink-900">{s.full_name}</span>
        {status === "saved" && (
          <p className="text-xs text-emerald-600">Saved.</p>
        )}
        {status === "error" && err && (
          <p className="text-xs text-red-600">{err}</p>
        )}
      </div>
      <Input
        type="text"
        inputMode="numeric"
        value={draft}
        disabled={status === "saving"}
        onChange={(e) => handleDraftChange(s.id, e.target.value)}
        aria-label={`Roll number for ${s.full_name}`}
        aria-invalid={isDup || status === "error"}
        className={"w-full sm:w-32 " + ringClass}
      />
    </li>
  );
})}
```

Pass the new props from `UpdateRollNumberSheet` to `<StudentsStep>`:
```tsx
<StudentsStep
  classId={classId}
  classGroupName={classGroupName}
  classLabel={classLabel}
  drafts={drafts}
  originals={originals}
  setDrafts={setDrafts}
  setOriginals={setOriginals}
  duplicates={duplicates}
  changedCount={changedIds.length}
  rowStatus={rowStatus}
  rowError={rowError}
  setRowStatus={setRowStatus}
  setRowError={setRowError}
  onBack={() => { /* unchanged from Task 3 */ }}
  onBackToClasses={() => { /* unchanged from Task 3 */ }}
/>
```

- [ ] **Step 5: Extend the close-reset `useEffect` to clear the new state**

```tsx
React.useEffect(() => {
  if (!open) {
    setStep("class");
    setClassGroupId(null);
    setClassGroupName("");
    setClassId(null);
    setClassLabel("");
    setDrafts({});
    setOriginals({});
    setRowStatus({});
    setRowError({});
    setSaving(false);
  }
}, [open]);
```

- [ ] **Step 6: Verify (typecheck + lint + build)**

Run, expecting all three to exit 0 with no new errors on the touched files:
```bash
npm run typecheck
npx eslint src/hooks/useSectionStudentsForRoll.ts src/components/school/UpdateRollNumberSheet.tsx src/components/school/BulkUpdateStudentsDialog.tsx src/pages/school/SchoolStudentsPage.tsx
npx vite build
```

- [ ] **Step 7: Browser smoke (full flow)**

End-to-end as a school_admin:
1. `/school/users` → Students → kebab → Update Details → click Update Roll Number → sheet opens.
2. Pick a class with multiple sections → pick Section A.
3. Edit two students' rolls to **the same** value → Save Changes is disabled, banner shows the duplicated value, both inputs are red-ringed.
4. Fix the duplicate → Save Changes enables → click it. Watch each row run "saving" → "saved" (green). Toast: "Updated N students."
5. Pre-test the server-side conflict: open another tab / DB, set a Section-B student's roll to something free in B but not in A; in your A view, edit some A student's roll to that same Section-B value. Save → that row turns red with the translated RPC message (e.g. *"Roll number 5 is already assigned to Priya in this class."*). Other rows still save. Save Changes re-enables after the partial save.
6. Edit a roll → click the sheet's `X` → confirm prompt appears. Cancel the prompt → still inside. Click Close in the footer → confirm prompt again. Confirm → sheet closes, drafts cleared.
7. Behind the sheet, the Students table now reflects the new roll numbers (verifies cache invalidation).
8. Re-open the sheet → drafts are empty (verifies close-reset).
9. Toggle dark mode while on Step 3 with edits in flight: page and inputs flip cleanly; red / green status rings still legible.
10. 375px width: row layout stacks (name above, input below), footer buttons full-width, no horizontal scroll.

- [ ] **Step 8: Commit**

```bash
git add src/components/school/UpdateRollNumberSheet.tsx
git commit -m "feat(students): batch-save roll numbers with per-row status and confirm-on-discard"
```

- [ ] **Step 9: Push the branch**

```bash
git push -u origin feat/update-roll-number-picker
```

Stop here. Open a PR (or merge to `main` if that's the project's convention for additive frontend-only features — recent specs in this repo are committed straight to main).

---

## Self-review checklist (run before claiming done)

- [ ] Spec section "Goal" — covered by the end-to-end flow in Tasks 1–4.
- [ ] Spec "User flow" steps 1–10 — exercised in Task 4 Step 7 browser smoke.
- [ ] Spec "Architecture" file list (2 new + 2 edited) — matches plan's File Structure.
- [ ] Spec "Data flow / Step 3 fetch" — Task 3's `useSectionStudentsForRoll` query matches the snippet.
- [ ] Spec "Save / sequential" — Task 4 uses a `for...of` await loop, not `Promise.all`.
- [ ] Spec "Cache invalidation" — Task 4 invalidates the three documented keys.
- [ ] Spec "Validation / client duplicate gate" — Task 3 builds the duplicate Map (lifted to parent) and disables Save.
- [ ] Spec "Server-side conflicts" — Task 4 catches per-row RPC errors and surfaces inline.
- [ ] Spec "Permission errors (42501)" — falls through the same per-row error path.
- [ ] Spec "Empty / loading states" — covered in Tasks 1, 2, 3 with `EmptyState`.
- [ ] Spec "UI compliance" — `MobileSheet`, `surface-card frosted-shadow rounded-card`, `text-ink-*`, `toastError`, dark-mode safe, 375px safe.
- [ ] Spec "Concurrency (§23)" — explicit columns only, `staleTime: 60_000`, sequential RPC calls.
- [ ] Spec "Testing" steps — Task 4 Step 7 covers them; final `vite build` runs in Task 4 Step 6.
- [ ] Spec "Rollout / no flag" — no flag mentioned in the plan.

If any item is unchecked at the end of execution, fix before opening the PR.
